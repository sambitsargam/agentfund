// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {AgentRatingRegistry} from "../src/AgentRatingRegistry.sol";

/// Deploys the registry trusting the forwarder given in FORWARDER_ADDRESS.
/// Simulation (cre workflow simulate --broadcast) uses the MockKeystoneForwarder;
/// a deployed workflow needs a registry that trusts the KeystoneForwarder instead.
contract DeployRegistry is Script {
  function run() external returns (AgentRatingRegistry registry) {
    address forwarder = vm.envAddress("FORWARDER_ADDRESS");
    vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
    registry = new AgentRatingRegistry(forwarder);
    vm.stopBroadcast();
    console.log("AgentRatingRegistry:", address(registry));
    console.log("forwarder:", forwarder);
  }
}
