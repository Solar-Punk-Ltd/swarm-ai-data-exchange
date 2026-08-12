// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {RevenueSplitter, SPLITTER_MAX_TAX_BPS} from "../src/RevenueSplitter.sol";
import {SplitterFactory} from "../src/SplitterFactory.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract SplitterFactoryTest is Test {
    SplitterFactory internal factory;
    MockERC20 internal usdc;

    address internal constant OWNER = address(0x0FFE1);
    address internal constant TREASURY = address(0x7EA);
    address internal constant SELLER = address(0xA11CE);
    address internal constant OTHER_SELLER = address(0xB0B);
    address internal constant STRANGER = address(0xBEEF);

    uint16 internal constant TAX_BPS = 500; // 5%

    function setUp() public {
        factory = new SplitterFactory(OWNER, TREASURY, TAX_BPS);
        usdc = new MockERC20("USD Coin", "USDC", 6);
    }

    // --- creation ---

    function test_createSplitter_matchesPrediction() public {
        address predicted = factory.predictSplitter(SELLER);
        address created = factory.createSplitter(SELLER);

        assertEq(created, predicted);
        assertEq(factory.splitterOf(SELLER), created);
    }

    function test_createSplitter_initializesTerms() public {
        RevenueSplitter splitter = RevenueSplitter(factory.createSplitter(SELLER));

        assertEq(splitter.seller(), SELLER);
        assertEq(splitter.treasury(), TREASURY);
        assertEq(splitter.taxBps(), TAX_BPS);
    }

    /// @dev Callers should be able to call this unconditionally before distributing without
    ///      first checking whether a clone exists.
    function test_createSplitter_isIdempotent() public {
        address first = factory.createSplitter(SELLER);
        address second = factory.createSplitter(SELLER);
        assertEq(first, second);
    }

    function test_createSplitter_isPermissionless() public {
        vm.prank(STRANGER);
        address splitter = factory.createSplitter(SELLER);
        assertEq(RevenueSplitter(splitter).seller(), SELLER);
    }

    function test_createSplitter_distinctPerSeller() public {
        assertTrue(factory.createSplitter(SELLER) != factory.createSplitter(OTHER_SELLER));
    }

    function test_createSplitter_revertsOnZeroSeller() public {
        vm.expectRevert(SplitterFactory.ZeroAddress.selector);
        factory.createSplitter(address(0));
    }

    /// @dev The property the whole publish flow leans on: a catalog can advertise `payTo`
    ///      before the clone exists, because an ERC-3009 transfer to a codeless address still
    ///      credits it. The clone only has to exist by distribution time.
    function test_counterfactual_fundsSurviveDeployment() public {
        address predicted = factory.predictSplitter(SELLER);
        assertEq(predicted.code.length, 0);

        usdc.mint(predicted, 1_000_000);

        RevenueSplitter splitter = RevenueSplitter(factory.createSplitter(SELLER));
        assertEq(address(splitter), predicted);

        splitter.distribute(address(usdc));
        assertEq(usdc.balanceOf(SELLER), 950_000);
        assertEq(usdc.balanceOf(TREASURY), 50_000);
    }

    // --- configuration ---

    function test_setTreasury_appliesToFutureClonesOnly() public {
        RevenueSplitter existing = RevenueSplitter(factory.createSplitter(SELLER));

        address newTreasury = address(0xFEE);
        vm.prank(OWNER);
        factory.setTreasury(newTreasury);

        RevenueSplitter fresh = RevenueSplitter(factory.createSplitter(OTHER_SELLER));

        assertEq(existing.treasury(), TREASURY, "existing clone terms must stay frozen");
        assertEq(fresh.treasury(), newTreasury);
    }

    function test_setDefaultTaxBps_appliesToFutureClonesOnly() public {
        RevenueSplitter existing = RevenueSplitter(factory.createSplitter(SELLER));

        vm.prank(OWNER);
        factory.setDefaultTaxBps(1_000);

        RevenueSplitter fresh = RevenueSplitter(factory.createSplitter(OTHER_SELLER));

        assertEq(existing.taxBps(), TAX_BPS, "existing clone terms must stay frozen");
        assertEq(fresh.taxBps(), 1_000);
    }

    function test_setTreasury_onlyOwner() public {
        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, STRANGER));
        factory.setTreasury(STRANGER);
    }

    function test_setDefaultTaxBps_onlyOwner() public {
        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, STRANGER));
        factory.setDefaultTaxBps(0);
    }

    function test_setDefaultTaxBps_revertsAboveCeiling() public {
        uint16 tooHigh = SPLITTER_MAX_TAX_BPS + 1;
        vm.prank(OWNER);
        vm.expectRevert(
            abi.encodeWithSelector(SplitterFactory.TaxTooHigh.selector, tooHigh, SPLITTER_MAX_TAX_BPS)
        );
        factory.setDefaultTaxBps(tooHigh);
    }

    function test_constructor_revertsAboveCeiling() public {
        uint16 tooHigh = SPLITTER_MAX_TAX_BPS + 1;
        vm.expectRevert(
            abi.encodeWithSelector(SplitterFactory.TaxTooHigh.selector, tooHigh, SPLITTER_MAX_TAX_BPS)
        );
        new SplitterFactory(OWNER, TREASURY, tooHigh);
    }

    function test_constructor_revertsOnZeroTreasury() public {
        vm.expectRevert(SplitterFactory.ZeroAddress.selector);
        new SplitterFactory(OWNER, address(0), TAX_BPS);
    }

    /// @dev The factory-deployed implementation must not be initializable by a passer-by.
    function test_implementation_isLocked() public {
        vm.expectRevert(RevenueSplitter.AlreadyInitialized.selector);
        RevenueSplitter(factory.implementation()).initialize(STRANGER, STRANGER, 0);
    }

    function testFuzz_predictSplitter_isStableAcrossSellers(address seller) public view {
        vm.assume(seller != address(0));
        assertEq(factory.predictSplitter(seller), factory.predictSplitter(seller));
    }
}
