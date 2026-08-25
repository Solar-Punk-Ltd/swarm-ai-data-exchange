// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {RevenueSplitter, SPLITTER_MAX_TAX_BPS} from "../src/RevenueSplitter.sol";
import {SplitterFactory} from "../src/SplitterFactory.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {BlockingERC20} from "./mocks/BlockingERC20.sol";

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

    // --- enumeration ---

    function test_registry_recordsClonesInCreationOrder() public {
        assertEq(factory.splitterCount(), 0);

        address first = factory.createSplitter(SELLER);
        address second = factory.createSplitter(OTHER_SELLER);

        assertEq(factory.splitterCount(), 2);
        assertEq(factory.splitterAt(0), first);
        assertEq(factory.splitterAt(1), second);
    }

    /// @dev The idempotent path must not append a duplicate, or a sweep would walk it twice.
    function test_registry_doesNotDuplicateOnRepeatCreate() public {
        factory.createSplitter(SELLER);
        factory.createSplitter(SELLER);
        assertEq(factory.splitterCount(), 1);
    }

    function test_splittersSlice_paginates() public {
        address[] memory created = _createSellers(5);

        address[] memory page = factory.splittersSlice(1, 2);
        assertEq(page.length, 2);
        assertEq(page[0], created[1]);
        assertEq(page[1], created[2]);
    }

    function test_splittersSlice_clampsLimitToEnd() public {
        _createSellers(3);
        assertEq(factory.splittersSlice(1, type(uint256).max).length, 2);
    }

    function test_splittersSlice_revertsPastEnd() public {
        _createSellers(2);
        vm.expectRevert(abi.encodeWithSelector(SplitterFactory.OffsetOutOfRange.selector, 3, 2));
        factory.splittersSlice(3, 1);
    }

    // --- batch distribution ---

    /// @dev The operator's collection call: one transaction, every seller's clone swept.
    function test_distributeAll_sweepsEverySeller() public {
        address[] memory splitters = _createSellers(3);
        for (uint256 i = 0; i < splitters.length; ++i) {
            usdc.mint(splitters[i], 1_000_000);
        }

        vm.prank(STRANGER);
        (uint256 swept, uint256 skipped) = factory.distributeAll(address(usdc), 0, type(uint256).max);

        assertEq(swept, 3);
        assertEq(skipped, 0);
        assertEq(usdc.balanceOf(TREASURY), 150_000, "5% of three 1_000_000 sales");
        for (uint256 i = 0; i < splitters.length; ++i) {
            assertEq(usdc.balanceOf(splitters[i]), 0);
            assertEq(usdc.balanceOf(_seller(i)), 950_000);
        }
    }

    function test_distributeAll_isPermissionless() public {
        address splitter = factory.createSplitter(SELLER);
        usdc.mint(splitter, 1_000_000);

        vm.prank(STRANGER);
        factory.distributeAll(address(usdc), 0, type(uint256).max);

        assertEq(usdc.balanceOf(TREASURY), 50_000);
    }

    function test_distributeAll_paginates() public {
        address[] memory splitters = _createSellers(3);
        for (uint256 i = 0; i < splitters.length; ++i) {
            usdc.mint(splitters[i], 1_000_000);
        }

        (uint256 swept,) = factory.distributeAll(address(usdc), 0, 2);

        assertEq(swept, 2);
        assertEq(usdc.balanceOf(splitters[0]), 0);
        assertEq(usdc.balanceOf(splitters[1]), 0);
        assertEq(usdc.balanceOf(splitters[2]), 1_000_000, "third clone is outside the page");
    }

    /// @dev Idle clones are a no-op, not a revert, so a sweep never has to pre-filter.
    function test_distributeAll_toleratesEmptyClones() public {
        _createSellers(2);
        (uint256 swept, uint256 skipped) = factory.distributeAll(address(usdc), 0, type(uint256).max);
        assertEq(swept, 2);
        assertEq(skipped, 0);
    }

    function test_distributeAll_onEmptyRegistry() public {
        (uint256 swept, uint256 skipped) = factory.distributeAll(address(usdc), 0, type(uint256).max);
        assertEq(swept, 0);
        assertEq(skipped, 0);
    }

    /// @dev The reason failures are caught: one blacklisted seller must not hold the treasury's
    ///      cut of everyone else's sales hostage.
    function test_distributeAll_skipsRevertingSplitter() public {
        BlockingERC20 token = new BlockingERC20();
        address[] memory splitters = _createSellers(2);
        token.mint(splitters[0], 1_000_000);
        token.mint(splitters[1], 1_000_000);
        token.block_(_seller(0));

        vm.expectEmit(true, true, false, false);
        emit SplitterFactory.DistributeSkipped(splitters[0], address(token));
        (uint256 swept, uint256 skipped) = factory.distributeAll(address(token), 0, type(uint256).max);

        assertEq(swept, 1);
        assertEq(skipped, 1);
        assertEq(token.balanceOf(splitters[0]), 1_000_000, "blocked clone keeps its balance");
        assertEq(token.balanceOf(_seller(1)), 950_000, "the healthy seller still got paid");
    }

    function test_distributeFor_sweepsExplicitList() public {
        address[] memory splitters = _createSellers(3);
        for (uint256 i = 0; i < splitters.length; ++i) {
            usdc.mint(splitters[i], 1_000_000);
        }

        address[] memory targets = new address[](2);
        targets[0] = splitters[0];
        targets[1] = splitters[2];

        (uint256 swept, uint256 skipped) = factory.distributeFor(targets, address(usdc));

        assertEq(swept, 2);
        assertEq(skipped, 0);
        assertEq(usdc.balanceOf(splitters[1]), 1_000_000, "untargeted clone is untouched");
        assertEq(usdc.balanceOf(TREASURY), 100_000);
    }

    /// @dev An address that is not a splitter at all must be counted, not fatal. A codeless target
    ///      is the case `try/catch` alone cannot handle — the compiler's `extcodesize` guard
    ///      reverts in the factory's own frame — so this asserts the pre-check, not the catch.
    function test_distributeFor_skipsUnknownAddress() public {
        address[] memory targets = new address[](1);
        targets[0] = STRANGER;

        vm.expectEmit(true, true, false, false);
        emit SplitterFactory.DistributeSkipped(STRANGER, address(usdc));
        (uint256 swept, uint256 skipped) = factory.distributeFor(targets, address(usdc));

        assertEq(swept, 0);
        assertEq(skipped, 1);
    }

    /// @dev A seller can be paid at a counterfactual `payTo` long before the clone is deployed.
    ///      Sweeping that address must skip it — and must not take the healthy clones down too.
    function test_distributeFor_skipsCounterfactualSplitterWithoutAbortingBatch() public {
        address deployed = factory.createSplitter(SELLER);
        address counterfactual = factory.predictSplitter(OTHER_SELLER);
        assertEq(counterfactual.code.length, 0, "clone must still be undeployed");

        usdc.mint(deployed, 1_000_000);
        usdc.mint(counterfactual, 1_000_000);

        address[] memory targets = new address[](2);
        targets[0] = counterfactual;
        targets[1] = deployed;

        (uint256 swept, uint256 skipped) = factory.distributeFor(targets, address(usdc));

        assertEq(swept, 1);
        assertEq(skipped, 1);
        assertEq(usdc.balanceOf(counterfactual), 1_000_000, "funds wait for createSplitter");
        assertEq(usdc.balanceOf(TREASURY), 50_000, "the deployed clone still swept");
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

    // --- helpers ---

    /// @dev Deterministic throwaway sellers, so a test can assert per-seller payouts by index.
    function _seller(uint256 index) internal pure returns (address) {
        return address(uint160(0x5E11E900 + index));
    }

    function _createSellers(uint256 count) internal returns (address[] memory splitters) {
        splitters = new address[](count);
        for (uint256 i = 0; i < count; ++i) {
            splitters[i] = factory.createSplitter(_seller(i));
        }
    }
}
