// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {RevenueSplitter, SPLITTER_MAX_TAX_BPS} from "./RevenueSplitter.sol";

/// @title SplitterFactory
/// @notice Deploys one `RevenueSplitter` clone per seller and keeps the registry of them.
/// @dev `splitterOf` is the single source of truth for a seller's `payTo`, and the only thing
///      enforcing one clone per seller — clones are deployed at ordinary CREATE addresses, so
///      nothing about the address itself prevents a duplicate. Every caller that needs a
///      seller's splitter reads the mapping; there is no off-chain way to derive it.
///
///      That ordering is deliberate. A seller deploys their own clone before listing, so the
///      seller pays for it rather than the operator who later runs a sweep, and a published
///      `payTo` always has code behind it.
contract SplitterFactory is Ownable {
    /// @notice The clone target. Deployed by this factory's constructor so implementation and
    ///         factory can never be mismatched.
    address public immutable implementation;

    /// @notice Treasury applied to clones created from now on. Changing it never affects
    ///         existing clones — their terms are frozen at initialization.
    address public treasury;

    /// @notice Sales tax in basis points applied to clones created from now on.
    uint16 public defaultTaxBps;

    /// @notice seller => splitter clone. Zero address when the seller has no clone yet.
    mapping(address => address) public splitterOf;

    /// @dev Every clone this factory has created, in creation order. Exposed through
    ///      `splitterCount` / `splitterAt` / `splittersSlice` rather than as a public array so
    ///      the read surface is explicitly paginated: an operator sweep must never be written
    ///      against an unbounded getter.
    address[] private _splitters;

    event SplitterCreated(
        address indexed seller, address indexed splitter, address treasury, uint16 taxBps
    );
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
    event DefaultTaxBpsUpdated(uint16 previousTaxBps, uint16 newTaxBps);

    /// @notice One splitter in a batch reverted and was skipped. The rest of the batch still ran.
    event DistributeSkipped(address indexed splitter, address indexed token);

    error ZeroAddress();
    error TaxTooHigh(uint16 taxBps, uint16 maxTaxBps);
    error OffsetOutOfRange(uint256 offset, uint256 length);

    constructor(address owner_, address treasury_, uint16 defaultTaxBps_) Ownable(owner_) {
        if (treasury_ == address(0)) revert ZeroAddress();
        _requireTaxWithinCeiling(defaultTaxBps_);

        implementation = address(new RevenueSplitter());
        treasury = treasury_;
        defaultTaxBps = defaultTaxBps_;
    }

    /// @notice Deploy `seller`'s splitter clone, or return the one they already have.
    /// @dev The `splitterOf` early-return is load-bearing, not a convenience: it is the only
    ///      thing keeping a seller's clone unique. Being idempotent also means a caller can run
    ///      this before distributing without checking first, and a repeat call costs one read.
    function createSplitter(address seller) external returns (address splitter) {
        if (seller == address(0)) revert ZeroAddress();

        splitter = splitterOf[seller];
        if (splitter != address(0)) return splitter;

        splitter = Clones.clone(implementation);
        splitterOf[seller] = splitter;
        _splitters.push(splitter);
        RevenueSplitter(splitter).initialize(seller, treasury, defaultTaxBps);

        emit SplitterCreated(seller, splitter, treasury, defaultTaxBps);
    }

    /// @notice How many splitter clones this factory has created.
    function splitterCount() external view returns (uint256) {
        return _splitters.length;
    }

    /// @notice The clone created at position `index`, in creation order.
    function splitterAt(uint256 index) external view returns (address) {
        return _splitters[index];
    }

    /// @notice A page of the clone registry. `limit` is clamped to the end of the array, so a
    ///         caller can pass `type(uint256).max` to read from `offset` to the end.
    function splittersSlice(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory page)
    {
        uint256 end = _rangeEnd(offset, limit);
        page = new address[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            page[i - offset] = _splitters[i];
        }
    }

    /// @notice Sweep `token` out of every clone in `[offset, offset + limit)` in one transaction.
    /// @dev This is the marketplace operator's collection call. It is permissionless for the same
    ///      reason `RevenueSplitter.distribute` is: a sweep can only move each clone's balance to
    ///      the seller and treasury addresses frozen at that clone's creation, so a third party
    ///      calling it can do nothing but pay the gas.
    ///
    ///      `limit` is clamped to the end of the registry — pass `type(uint256).max` to mean "all
    ///      remaining". Paginate when the registry outgrows a block: the loop is O(n) external
    ///      calls and there is no gas ceiling that makes "all sellers" safe forever.
    ///
    ///      A clone that reverts is skipped, not propagated, so one seller whose token transfer
    ///      fails (a USDC blacklisting, say) cannot block everyone else's payout. Note the 63/64
    ///      gas rule still applies: a callee that burns all forwarded gas can starve the rest of
    ///      the loop even though its own revert is caught. Every clone runs identical, trusted
    ///      code, so the only realistic failure source is the token itself.
    /// @return swept Number of clones whose `distribute` call succeeded (a zero balance counts —
    ///         `distribute` no-ops rather than reverting).
    /// @return skipped Number of clones that reverted, or had no code, and were passed over.
    function distributeAll(address token, uint256 offset, uint256 limit)
        external
        returns (uint256 swept, uint256 skipped)
    {
        uint256 end = _rangeEnd(offset, limit);
        for (uint256 i = offset; i < end; ++i) {
            (swept, skipped) = _tryDistribute(_splitters[i], token, swept, skipped);
        }
    }

    /// @notice Sweep `token` out of an explicit set of clones.
    /// @dev For keepers that already know which splitters have a non-zero `pending` balance and
    ///      would rather not pay for a walk over idle ones. Addresses are not checked against the
    ///      registry, only for code — an EOA, or any address without a splitter behind it, is
    ///      counted as skipped.
    function distributeFor(address[] calldata splitters, address token)
        external
        returns (uint256 swept, uint256 skipped)
    {
        for (uint256 i = 0; i < splitters.length; ++i) {
            (swept, skipped) = _tryDistribute(splitters[i], token, swept, skipped);
        }
    }

    /// @dev Shared body of the two batch entry points. Returns the running tallies rather than
    ///      mutating storage or locals by reference, so both callers stay branch-free.
    ///
    ///      The code-length check is load-bearing, not defensive. `distribute` returns nothing, so
    ///      the compiler emits an `extcodesize` guard in *this* frame before the call; that revert
    ///      happens outside the callee and `try/catch` cannot see it, which would abort the whole
    ///      batch. (The guard is only elided for calls that expect return data — solidity#12725.)
    ///      Screening for code first turns that fatal case back into an ordinary skip.
    function _tryDistribute(address splitter, address token, uint256 swept, uint256 skipped)
        private
        returns (uint256, uint256)
    {
        if (splitter.code.length == 0) {
            emit DistributeSkipped(splitter, token);
            return (swept, skipped + 1);
        }

        try RevenueSplitter(splitter).distribute(token) {
            return (swept + 1, skipped);
        } catch {
            emit DistributeSkipped(splitter, token);
            return (swept, skipped + 1);
        }
    }

    /// @dev Exclusive end of a `[offset, offset + limit)` window over `_splitters`, clamped to the
    ///      array length so `type(uint256).max` is a valid "to the end" sentinel and cannot
    ///      overflow. An `offset` past the end is a caller bug, not an empty page, so it reverts.
    function _rangeEnd(uint256 offset, uint256 limit) private view returns (uint256) {
        uint256 length = _splitters.length;
        if (offset > length) revert OffsetOutOfRange(offset, length);

        uint256 remaining = length - offset;
        return offset + (limit > remaining ? remaining : limit);
    }

    /// @notice Set the treasury used by *future* clones.
    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, treasury_);
        treasury = treasury_;
    }

    /// @notice Set the tax rate used by *future* clones.
    function setDefaultTaxBps(uint16 defaultTaxBps_) external onlyOwner {
        _requireTaxWithinCeiling(defaultTaxBps_);
        emit DefaultTaxBpsUpdated(defaultTaxBps, defaultTaxBps_);
        defaultTaxBps = defaultTaxBps_;
    }

    /// @dev `initialize` enforces this too; checking here surfaces a bad rate at configuration
    ///      time instead of at the next `createSplitter`.
    function _requireTaxWithinCeiling(uint16 taxBps_) private pure {
        if (taxBps_ > SPLITTER_MAX_TAX_BPS) revert TaxTooHigh(taxBps_, SPLITTER_MAX_TAX_BPS);
    }
}
