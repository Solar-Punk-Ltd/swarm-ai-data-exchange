// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {RevenueSplitter, SPLITTER_MAX_TAX_BPS} from "../src/RevenueSplitter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract RevenueSplitterTest is Test {
    RevenueSplitter internal implementation;
    RevenueSplitter internal splitter;
    MockERC20 internal usdc;
    MockERC20 internal bzz;

    address internal constant SELLER = address(0xA11CE);
    address internal constant TREASURY = address(0x7EA);
    address internal constant STRANGER = address(0xBEEF);

    uint16 internal constant TAX_BPS = 500; // 5%

    event Distributed(address indexed token, uint256 sellerAmount, uint256 treasuryAmount);

    function setUp() public {
        implementation = new RevenueSplitter();
        splitter = RevenueSplitter(Clones.clone(address(implementation)));
        splitter.initialize(SELLER, TREASURY, TAX_BPS);

        usdc = new MockERC20("USD Coin", "USDC", 6);
        bzz = new MockERC20("Swarm", "BZZ", 18);
    }

    // --- initialization ---

    function test_initialize_setsTerms() public view {
        assertEq(splitter.seller(), SELLER);
        assertEq(splitter.treasury(), TREASURY);
        assertEq(splitter.taxBps(), TAX_BPS);
    }

    function test_initialize_revertsOnSecondCall() public {
        vm.expectRevert(RevenueSplitter.AlreadyInitialized.selector);
        splitter.initialize(STRANGER, STRANGER, 0);
    }

    /// @dev The implementation is locked in its own constructor, so it can never be adopted and
    ///      used as a live splitter by whoever finds it first.
    function test_initialize_revertsOnImplementation() public {
        vm.expectRevert(RevenueSplitter.AlreadyInitialized.selector);
        implementation.initialize(STRANGER, STRANGER, 0);
    }

    function test_initialize_revertsOnZeroAddress() public {
        RevenueSplitter fresh = RevenueSplitter(Clones.clone(address(implementation)));
        vm.expectRevert(RevenueSplitter.ZeroAddress.selector);
        fresh.initialize(address(0), TREASURY, TAX_BPS);

        vm.expectRevert(RevenueSplitter.ZeroAddress.selector);
        fresh.initialize(SELLER, address(0), TAX_BPS);
    }

    function test_initialize_revertsAboveMaxTax() public {
        RevenueSplitter fresh = RevenueSplitter(Clones.clone(address(implementation)));
        uint16 tooHigh = SPLITTER_MAX_TAX_BPS + 1;
        vm.expectRevert(
            abi.encodeWithSelector(RevenueSplitter.TaxTooHigh.selector, tooHigh, SPLITTER_MAX_TAX_BPS)
        );
        fresh.initialize(SELLER, TREASURY, tooHigh);
    }

    // --- distribution ---

    function test_distribute_splitsBalance() public {
        usdc.mint(address(splitter), 1_000_000); // 1 USDC

        vm.expectEmit(true, false, false, true, address(splitter));
        emit Distributed(address(usdc), 950_000, 50_000);
        splitter.distribute(address(usdc));

        assertEq(usdc.balanceOf(SELLER), 950_000);
        assertEq(usdc.balanceOf(TREASURY), 50_000);
        assertEq(usdc.balanceOf(address(splitter)), 0);
    }

    /// @dev Anyone may trigger payout — the seller must never depend on the marketplace to
    ///      reach their funds, and the treasury must be able to batch sweeps.
    function test_distribute_isPermissionless() public {
        usdc.mint(address(splitter), 1_000_000);

        vm.prank(STRANGER);
        splitter.distribute(address(usdc));

        assertEq(usdc.balanceOf(SELLER), 950_000);
        assertEq(usdc.balanceOf(TREASURY), 50_000);
        assertEq(usdc.balanceOf(STRANGER), 0);
    }

    /// @dev Must not revert: a batched sweep across tokens would otherwise abort on the first
    ///      token that happened to have no sales.
    function test_distribute_zeroBalanceIsNoop() public {
        splitter.distribute(address(usdc));
        assertEq(usdc.balanceOf(SELLER), 0);
        assertEq(usdc.balanceOf(TREASURY), 0);
    }

    function test_distribute_accumulatesAcrossSales() public {
        usdc.mint(address(splitter), 1_000_000);
        usdc.mint(address(splitter), 3_000_000);
        usdc.mint(address(splitter), 6_000_000);

        splitter.distribute(address(usdc));

        assertEq(usdc.balanceOf(TREASURY), 500_000); // 5% of 10 USDC
        assertEq(usdc.balanceOf(SELLER), 9_500_000);
    }

    function test_distributeMany_sweepsTokensIndependently() public {
        usdc.mint(address(splitter), 1_000_000);
        bzz.mint(address(splitter), 2 ether);

        address[] memory tokens = new address[](2);
        tokens[0] = address(usdc);
        tokens[1] = address(bzz);
        splitter.distributeMany(tokens);

        assertEq(usdc.balanceOf(TREASURY), 50_000);
        assertEq(usdc.balanceOf(SELLER), 950_000);
        assertEq(bzz.balanceOf(TREASURY), 0.1 ether);
        assertEq(bzz.balanceOf(SELLER), 1.9 ether);
    }

    function test_pending_matchesDistribute() public {
        usdc.mint(address(splitter), 1_234_567);

        (uint256 sellerAmount, uint256 treasuryAmount) = splitter.pending(address(usdc));
        splitter.distribute(address(usdc));

        assertEq(usdc.balanceOf(SELLER), sellerAmount);
        assertEq(usdc.balanceOf(TREASURY), treasuryAmount);
    }

    // --- invariants ---

    /// @dev The core invariant: the two shares always sum to exactly the balance, so no dust is
    ///      ever stranded in the splitter regardless of amount or rate.
    function testFuzz_distribute_conservesBalance(uint128 amount, uint16 taxBps) public {
        taxBps = uint16(bound(taxBps, 0, SPLITTER_MAX_TAX_BPS));
        vm.assume(amount > 0);

        RevenueSplitter fresh = RevenueSplitter(Clones.clone(address(implementation)));
        fresh.initialize(SELLER, TREASURY, taxBps);
        usdc.mint(address(fresh), amount);

        fresh.distribute(address(usdc));

        assertEq(usdc.balanceOf(SELLER) + usdc.balanceOf(TREASURY), amount);
        assertEq(usdc.balanceOf(address(fresh)), 0);
    }

    /// @dev Rounding must never favour the treasury: dust below one unit falls to the seller.
    function testFuzz_distribute_dustFavoursSeller(uint128 amount, uint16 taxBps) public {
        taxBps = uint16(bound(taxBps, 1, SPLITTER_MAX_TAX_BPS));
        vm.assume(amount > 0);

        RevenueSplitter fresh = RevenueSplitter(Clones.clone(address(implementation)));
        fresh.initialize(SELLER, TREASURY, taxBps);
        usdc.mint(address(fresh), amount);

        fresh.distribute(address(usdc));

        uint256 exactTax = (uint256(amount) * taxBps) / 10_000;
        assertEq(usdc.balanceOf(TREASURY), exactTax);
        assertGe(usdc.balanceOf(SELLER), uint256(amount) - exactTax);
    }
}
