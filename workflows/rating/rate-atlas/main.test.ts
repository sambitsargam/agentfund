import { describe, expect } from "bun:test";
import { test } from "@chainlink/cre-sdk/test";
import { initWorkflow, type Config } from "./main";
import { challengeFor, scoreObservation } from "./scoring";

describe("scoreObservation", () => {
  test("gives full marks at the caps with a fast passing probe", async () => {
    const s = scoreObservation({ earnings: 10_000_000n, txCount: 20n, probeOk: true, latencyMs: 400n });
    expect(s.total).toBe(1000n);
  });

  test("scales earnings and activity linearly below the caps", async () => {
    const s = scoreObservation({ earnings: 1_000_000n, txCount: 3n, probeOk: true, latencyMs: 2500n });
    expect([s.earningsPoints, s.activityPoints, s.probePoints, s.latencyPoints]).toEqual([40n, 45n, 200n, 50n]);
    expect(s.total).toBe(335n);
  });

  test("a failing probe earns no probe or latency points", async () => {
    const s = scoreObservation({ earnings: 0n, txCount: 0n, probeOk: false, latencyMs: 10n });
    expect(s.total).toBe(0n);
  });
});

describe("challengeFor", () => {
  test("is the same within a minute and changes after it", async () => {
    const a = challengeFor(new Date("2026-10-06T04:00:05Z"));
    expect(challengeFor(new Date("2026-10-06T04:00:55Z"))).toBe(a);
    expect(challengeFor(new Date("2026-10-06T04:01:00Z"))).not.toBe(a);
  });
});

describe("initWorkflow", () => {
  test("registers a cron handler and an HTTP refresh handler", async () => {
    const handlers = initWorkflow({ schedule: "0 */15 * * * *", authorizedKeys: [] } as unknown as Config);
    expect(handlers).toHaveLength(2);
  });
});
