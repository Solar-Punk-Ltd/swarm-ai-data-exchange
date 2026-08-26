// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {SplitterFactory} from "../src/SplitterFactory.sol";

/// @notice Deploys `SplitterFactory` (which deploys its own `RevenueSplitter` implementation)
///         and records the addresses under `deployments/<network>.json`.
///
/// Usage:
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url $RPC_URL --broadcast --verify
///
/// Env:
///   PRIVATE_KEY      deployer key (also the default factory owner)
///   TREASURY_ADDRESS marketplace treasury receiving the tax share
///   DEFAULT_TAX_BPS  sales tax in basis points (e.g. 500 = 5%)
///   FACTORY_OWNER    optional; defaults to the deployer
///   DEPLOYMENT_NAME  optional; output file name, defaults to "base-sepolia"
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        uint16 defaultTaxBps = uint16(vm.envUint("DEFAULT_TAX_BPS"));
        address owner = vm.envOr("FACTORY_OWNER", vm.addr(deployerKey));
        string memory name = vm.envOr("DEPLOYMENT_NAME", string("base-sepolia"));

        vm.startBroadcast(deployerKey);
        SplitterFactory factory = new SplitterFactory(owner, treasury, defaultTaxBps);
        vm.stopBroadcast();

        console2.log("SplitterFactory:", address(factory));
        console2.log("RevenueSplitter implementation:", factory.implementation());

        string memory json = "deployment";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "factory", address(factory));
        vm.serializeAddress(json, "implementation", factory.implementation());
        vm.serializeAddress(json, "treasury", treasury);
        vm.serializeAddress(json, "owner", owner);
        string memory out = vm.serializeUint(json, "defaultTaxBps", defaultTaxBps);

        vm.writeJson(out, string.concat("deployments/", name, ".json"));
    }
}
