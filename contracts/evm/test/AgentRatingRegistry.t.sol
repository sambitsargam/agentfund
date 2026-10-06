// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {AgentRatingRegistry} from "../src/AgentRatingRegistry.sol";
import {IReceiver} from "../src/chainlink/IReceiver.sol";

contract AgentRatingRegistryTest is Test {
  address constant FORWARDER = 0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5;
  bytes32 constant ATLAS = keccak256("atlas");
  bytes32 constant REQUEST = keccak256("request-1");

  AgentRatingRegistry registry;

  event RatingUpdated(
    bytes32 indexed agentId,
    uint16 score,
    uint256 earnings,
    uint32 paymentCount,
    bool probeOk,
    uint32 latencyMs,
    uint64 observedAt
  );
  event PaymentDecision(
    bytes32 indexed requestId,
    bytes32 indexed agentId,
    AgentRatingRegistry.Verdict verdict,
    uint32 riskFlags,
    uint16 ratingUsed,
    uint64 decidedAt
  );

  function setUp() public {
    vm.warp(1_791_260_000);
    registry = new AgentRatingRegistry(FORWARDER);
  }

  function rating(uint16 score, uint64 observedAt) internal pure returns (bytes memory) {
    return abi.encode(uint8(1), abi.encode(ATLAS, score, uint256(1_000_000), uint32(2), true, uint32(840), observedAt));
  }

  function decision(uint8 verdict, uint64 decidedAt) internal pure returns (bytes memory) {
    return abi.encode(uint8(2), abi.encode(REQUEST, ATLAS, verdict, uint32(0), uint16(830), decidedAt));
  }

  function deliver(bytes memory report) internal {
    vm.prank(FORWARDER);
    registry.onReport("", report);
  }

  function test_storesRatingAndEmits() public {
    uint64 t = uint64(block.timestamp);
    vm.expectEmit(true, false, false, true);
    emit RatingUpdated(ATLAS, 830, 1_000_000, 2, true, 840, t);
    deliver(rating(830, t));

    AgentRatingRegistry.Rating memory r = registry.getRating(ATLAS);
    assertEq(r.score, 830);
    assertEq(r.earnings, 1_000_000);
    assertEq(r.paymentCount, 2);
    assertTrue(r.probeOk);
    assertEq(r.latencyMs, 840);
    assertEq(r.observedAt, t);
  }

  function test_storesDecisionAndEmits() public {
    uint64 t = uint64(block.timestamp);
    vm.expectEmit(true, true, false, true);
    emit PaymentDecision(REQUEST, ATLAS, AgentRatingRegistry.Verdict.Deny, 0, 830, t);
    deliver(decision(2, t));

    AgentRatingRegistry.Decision memory d = registry.getDecision(REQUEST);
    assertEq(d.agentId, ATLAS);
    assertEq(uint8(d.verdict), 2);
    assertEq(d.ratingUsed, 830);
  }

  function test_rejectsUnknownKind() public {
    vm.prank(FORWARDER);
    vm.expectRevert(abi.encodeWithSelector(AgentRatingRegistry.UnknownReportKind.selector, uint8(7)));
    registry.onReport("", abi.encode(uint8(7), bytes("")));
  }

  function test_rejectsReplayedRating() public {
    uint64 t = uint64(block.timestamp);
    deliver(rating(830, t));
    vm.prank(FORWARDER);
    vm.expectRevert(abi.encodeWithSelector(AgentRatingRegistry.StaleReport.selector, t, t));
    registry.onReport("", rating(900, t));
  }

  function test_rejectsOlderDecision() public {
    uint64 t = uint64(block.timestamp);
    deliver(decision(1, t));
    vm.prank(FORWARDER);
    vm.expectRevert(abi.encodeWithSelector(AgentRatingRegistry.StaleReport.selector, t, t - 1));
    registry.onReport("", decision(2, t - 1));
  }

  function test_acceptsNewerRating() public {
    uint64 t = uint64(block.timestamp);
    deliver(rating(830, t - 60));
    deliver(rating(900, t));
    assertEq(registry.getRating(ATLAS).score, 900);
  }

  function test_rejectsFutureTimestamp() public {
    uint64 future = uint64(block.timestamp + 1 hours);
    vm.prank(FORWARDER);
    vm.expectRevert(abi.encodeWithSelector(AgentRatingRegistry.TimestampInFuture.selector, future, block.timestamp));
    registry.onReport("", rating(830, future));
  }

  function test_rejectsScoreAboveMax() public {
    vm.prank(FORWARDER);
    vm.expectRevert(abi.encodeWithSelector(AgentRatingRegistry.ScoreOutOfRange.selector, uint16(1001)));
    registry.onReport("", rating(1001, uint64(block.timestamp)));
  }

  function test_rejectsInvalidVerdict() public {
    vm.prank(FORWARDER);
    vm.expectRevert(abi.encodeWithSelector(AgentRatingRegistry.InvalidVerdict.selector, uint8(4)));
    registry.onReport("", decision(4, uint64(block.timestamp)));
  }

  function test_rejectsCallerOtherThanForwarder() public {
    vm.prank(address(0xBEEF));
    vm.expectRevert();
    registry.onReport("", rating(830, uint64(block.timestamp)));
  }

  function test_supportsIReceiver() public view {
    assertTrue(registry.supportsInterface(type(IReceiver).interfaceId));
  }
}
