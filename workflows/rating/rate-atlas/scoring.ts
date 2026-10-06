import { keccak256, toHex, type Hex } from "viem";

export type Observation = {
  earnings: bigint;
  txCount: bigint;
  probeOk: boolean;
  latencyMs: bigint;
};

export type Score = {
  total: bigint;
  earningsPoints: bigint;
  activityPoints: bigint;
  probePoints: bigint;
  latencyPoints: bigint;
};

export const RATING_KIND = 1;
const EARNINGS_CAP = 10_000_000n; // 10 tUSDM earns the full 400 points
const ACTIVITY_CAP = 20n; // 20 transactions earn the full 300 points

/** Deterministic score out of 1000; every node computes the same value from the agreed observation. */
export function scoreObservation(o: Observation): Score {
  const earningsPoints = (400n * (o.earnings < EARNINGS_CAP ? o.earnings : EARNINGS_CAP)) / EARNINGS_CAP;
  const activityPoints = (300n * (o.txCount < ACTIVITY_CAP ? o.txCount : ACTIVITY_CAP)) / ACTIVITY_CAP;
  const probePoints = o.probeOk ? 200n : 0n;
  const latencyPoints = !o.probeOk ? 0n : o.latencyMs < 2000n ? 100n : o.latencyMs < 5000n ? 50n : 0n;
  return {
    total: earningsPoints + activityPoints + probePoints + latencyPoints,
    earningsPoints,
    activityPoints,
    probePoints,
    latencyPoints,
  };
}

/** Same challenge on every node: derived from DON consensus time, rounded to the minute. */
export function challengeFor(now: Date): Hex {
  return keccak256(toHex(`atlas-probe:${Math.floor(now.getTime() / 60_000)}`));
}
