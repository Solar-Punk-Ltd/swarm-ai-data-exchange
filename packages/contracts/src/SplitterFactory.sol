// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {RevenueSplitter, SPLITTER_MAX_TAX_BPS} from "./RevenueSplitter.sol";

/// @title SplitterFactory
/// @notice Deploys one `RevenueSplitter` clone per seller at a deterministic (CREATE2) address.
/// @dev The determinism is load-bearing, not a convenience: a publisher can compute a seller's
///      `payTo` with `predictSplitter` and publish a catalog referencing it *before* the clone
///      exists. An x402 `exact` settlement is an ERC-3009 `transferWithAuthorization`, i.e. a
///      plain ERC-20 balance move with no callback, so funds land at the predicted address
///      whether or not code is deployed there. The clone only has to exist by the time someone
///      calls `distribute`.
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

    event SplitterCreated(
        address indexed seller, address indexed splitter, address treasury, uint16 taxBps
    );
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
    event DefaultTaxBpsUpdated(uint16 previousTaxBps, uint16 newTaxBps);

    error ZeroAddress();
    error TaxTooHigh(uint16 taxBps, uint16 maxTaxBps);

    constructor(address owner_, address treasury_, uint16 defaultTaxBps_) Ownable(owner_) {
        if (treasury_ == address(0)) revert ZeroAddress();
        _requireTaxWithinCeiling(defaultTaxBps_);

        implementation = address(new RevenueSplitter());
        treasury = treasury_;
        defaultTaxBps = defaultTaxBps_;
    }

    /// @notice Deterministic address of `seller`'s splitter, deployed or not.
    function predictSplitter(address seller) public view returns (address) {
        return Clones.predictDeterministicAddress(implementation, _salt(seller), address(this));
    }

    /// @notice Deploy `seller`'s splitter clone. Idempotent — returns the existing clone if one
    ///         has already been created, so a caller can always call this before distributing
    ///         without checking first.
    function createSplitter(address seller) external returns (address splitter) {
        if (seller == address(0)) revert ZeroAddress();

        splitter = splitterOf[seller];
        if (splitter != address(0)) return splitter;

        splitter = Clones.cloneDeterministic(implementation, _salt(seller));
        splitterOf[seller] = splitter;
        RevenueSplitter(splitter).initialize(seller, treasury, defaultTaxBps);

        emit SplitterCreated(seller, splitter, treasury, defaultTaxBps);
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

    /// @dev One clone per seller: the salt carries the seller and nothing else.
    function _salt(address seller) private pure returns (bytes32) {
        return keccak256(abi.encode(seller));
    }
}
