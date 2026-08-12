// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev File-level so `SplitterFactory` can import and validate against the same values the
///      clone enforces, without a cross-contract call or a duplicated literal.
uint16 constant SPLITTER_BPS_DENOMINATOR = 10_000;
uint16 constant SPLITTER_MAX_TAX_BPS = 2_000;

/// @title RevenueSplitter
/// @notice Per-seller x402 `payTo` destination. Receives a purchase settlement in full and
///         releases it fractionally on a later, permissionless `distribute` call:
///         `taxBps` to the marketplace treasury, the remainder to the seller.
/// @dev Deployed once as a clone target (EIP-1167) by `SplitterFactory`. Clones cannot use
///      `immutable`, so terms live in storage and are frozen by a one-shot `initialize`.
///
///      Accounting is *balance-based*: entitlement is derived from this contract's own token
///      balance at distribution time rather than tracked per sale. That is what makes the
///      contract token-agnostic (any ERC-20, any decimals, fee-on-transfer included) and why
///      a normal x402 payment is taxed correctly with no special buyer behaviour — the buyer
///      just transfers to an address.
contract RevenueSplitter {
    using SafeERC20 for IERC20;

    /// @notice Denominator for `taxBps`. 10_000 bps == 100%.
    uint16 public constant BPS_DENOMINATOR = SPLITTER_BPS_DENOMINATOR;

    /// @notice Hard ceiling on the tax rate, so a misconfigured factory can never mint a clone
    ///         that swallows a seller's proceeds.
    uint16 public constant MAX_TAX_BPS = SPLITTER_MAX_TAX_BPS;

    /// @notice Recipient of the (1 - t) share.
    address public seller;

    /// @notice Recipient of the t share (marketplace treasury).
    address public treasury;

    /// @notice Marketplace sales tax, in basis points, routed to `treasury`.
    uint16 public taxBps;

    bool private _initialized;

    event SplitterInitialized(address indexed seller, address indexed treasury, uint16 taxBps);
    event Distributed(address indexed token, uint256 sellerAmount, uint256 treasuryAmount);

    error AlreadyInitialized();
    error ZeroAddress();
    error TaxTooHigh(uint16 taxBps, uint16 maxTaxBps);

    /// @dev Locks the implementation contract itself. Only clones — which start with fresh
    ///      storage — can ever be initialized.
    constructor() {
        _initialized = true;
    }

    /// @notice Freeze this clone's terms. Callable exactly once, by the factory, at clone time.
    /// @dev Terms are deliberately immutable after this point: the buyer signs an EIP-712
    ///      `PurchaseIntent` over the exact `payTo` address, so a splitter whose seller or rate
    ///      could change afterwards would let the destination be re-pointed under a signature
    ///      that has already been given. Changing terms means a new clone and a republished
    ///      catalog entry.
    function initialize(address seller_, address treasury_, uint16 taxBps_) external {
        if (_initialized) revert AlreadyInitialized();
        if (seller_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (taxBps_ > MAX_TAX_BPS) revert TaxTooHigh(taxBps_, MAX_TAX_BPS);

        _initialized = true;
        seller = seller_;
        treasury = treasury_;
        taxBps = taxBps_;

        emit SplitterInitialized(seller_, treasury_, taxBps_);
    }

    /// @notice Amounts each party would receive if `distribute(token)` were called right now.
    function pending(address token)
        public
        view
        returns (uint256 sellerAmount, uint256 treasuryAmount)
    {
        uint256 balance = IERC20(token).balanceOf(address(this));
        treasuryAmount = (balance * taxBps) / BPS_DENOMINATOR;
        sellerAmount = balance - treasuryAmount;
    }

    /// @notice Release the accrued balance of `token` to seller and treasury. Permissionless —
    ///         either party (or anyone) may call it, so the seller never depends on the
    ///         marketplace to reach their funds, and the treasury can batch sweeps for gas.
    /// @dev A zero balance is a no-op rather than a revert, so a batched multi-token sweep is
    ///      not aborted by one token that happened to have no sales.
    function distribute(address token) public {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance == 0) return;

        // Integer division truncates, so the treasury is rounded down and the dust (< 1 unit)
        // falls to the seller. `sellerAmount` is computed by subtraction, never independently,
        // so the two shares always sum to exactly `balance`.
        uint256 treasuryAmount = (balance * taxBps) / BPS_DENOMINATOR;
        uint256 sellerAmount = balance - treasuryAmount;

        emit Distributed(token, sellerAmount, treasuryAmount);

        if (treasuryAmount > 0) {
            IERC20(token).safeTransfer(treasury, treasuryAmount);
        }
        if (sellerAmount > 0) {
            IERC20(token).safeTransfer(seller, sellerAmount);
        }
    }

    /// @notice Sweep several tokens in one transaction.
    function distributeMany(address[] calldata tokens) external {
        for (uint256 i = 0; i < tokens.length; ++i) {
            distribute(tokens[i]);
        }
    }
}
