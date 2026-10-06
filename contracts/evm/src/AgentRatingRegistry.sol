// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReceiverTemplate} from "./chainlink/ReceiverTemplate.sol";

/// @notice On-chain record of what Chainlink CRE observed about funded agents.
/// Two workflows write here through the Chainlink forwarder:
///   kind 1 (rating):           the rating workflow's periodic score for an agent;
///   kind 2 (payment decision): the payment gate's verdict on one proposed payment.
/// Each report is abi.encode(uint8 kind, bytes body).
contract AgentRatingRegistry is ReceiverTemplate {
  uint8 public constant KIND_RATING = 1;
  uint8 public constant KIND_DECISION = 2;
  uint16 public constant MAX_SCORE = 1000;
  /// DON time can run slightly ahead of the block that includes the report.
  uint64 public constant MAX_CLOCK_SKEW = 5 minutes;

  enum Verdict {
    None,
    Allow,
    Deny,
    Review
  }

  struct Rating {
    uint16 score;
    uint256 earnings;
    uint32 paymentCount;
    bool probeOk;
    uint32 latencyMs;
    uint64 observedAt;
  }

  struct Decision {
    bytes32 agentId;
    Verdict verdict;
    uint32 riskFlags;
    uint16 ratingUsed;
    uint64 decidedAt;
  }

  mapping(bytes32 agentId => Rating) private s_ratings;
  mapping(bytes32 requestId => Decision) private s_decisions;

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
    Verdict verdict,
    uint32 riskFlags,
    uint16 ratingUsed,
    uint64 decidedAt
  );

  error UnknownReportKind(uint8 kind);
  error StaleReport(uint64 stored, uint64 received);
  error TimestampInFuture(uint64 received, uint256 blockTime);
  error ScoreOutOfRange(uint16 score);
  error InvalidVerdict(uint8 verdict);

  constructor(address forwarder) ReceiverTemplate(forwarder) {}

  function getRating(bytes32 agentId) external view returns (Rating memory) {
    return s_ratings[agentId];
  }

  function getDecision(bytes32 requestId) external view returns (Decision memory) {
    return s_decisions[requestId];
  }

  function _processReport(bytes calldata report) internal override {
    (uint8 kind, bytes memory body) = abi.decode(report, (uint8, bytes));
    if (kind == KIND_RATING) {
      _storeRating(body);
    } else if (kind == KIND_DECISION) {
      _storeDecision(body);
    } else {
      revert UnknownReportKind(kind);
    }
  }

  function _storeRating(bytes memory body) private {
    (
      bytes32 agentId,
      uint16 score,
      uint256 earnings,
      uint32 paymentCount,
      bool probeOk,
      uint32 latencyMs,
      uint64 observedAt
    ) = abi.decode(body, (bytes32, uint16, uint256, uint32, bool, uint32, uint64));

    if (score > MAX_SCORE) revert ScoreOutOfRange(score);
    _requireFresh(s_ratings[agentId].observedAt, observedAt);

    s_ratings[agentId] = Rating(score, earnings, paymentCount, probeOk, latencyMs, observedAt);
    emit RatingUpdated(agentId, score, earnings, paymentCount, probeOk, latencyMs, observedAt);
  }

  function _storeDecision(bytes memory body) private {
    (bytes32 requestId, bytes32 agentId, uint8 verdict, uint32 riskFlags, uint16 ratingUsed, uint64 decidedAt) =
      abi.decode(body, (bytes32, bytes32, uint8, uint32, uint16, uint64));

    if (verdict == uint8(Verdict.None) || verdict > uint8(Verdict.Review)) revert InvalidVerdict(verdict);
    _requireFresh(s_decisions[requestId].decidedAt, decidedAt);

    s_decisions[requestId] = Decision(agentId, Verdict(verdict), riskFlags, ratingUsed, decidedAt);
    emit PaymentDecision(requestId, agentId, Verdict(verdict), riskFlags, ratingUsed, decidedAt);
  }

  /// Replay protection: a report must be newer than what is stored and not from the future.
  function _requireFresh(uint64 stored, uint64 received) private view {
    if (received <= stored) revert StaleReport(stored, received);
    if (received > block.timestamp + MAX_CLOCK_SKEW) revert TimestampInFuture(received, block.timestamp);
  }
}
