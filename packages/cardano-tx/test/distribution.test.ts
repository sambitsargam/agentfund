import { describe, expect, it } from "vitest";
import { ATLAS_DEAL } from "@agentfund/shared";
import { MAX_BATCH, buildSplitter, planDistribution } from "../src/index.js";

const X402 = "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9.0014df10745553444d";
const MASUMI = "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde.0014df10745553444d";
const splitter = buildSplitter(ATLAS_DEAL);
const addresses = { atlas: ATLAS_DEAL.atlasAddress, investors: ATLAS_DEAL.investors.map((i) => i.address) };
const coin = (i: number, x402: bigint, masumi = 0n) => ({ txHash: "ab".repeat(32), index: i, amounts: { [X402]: x402, [MASUMI]: masumi } });

describe("planDistribution", () => {
  it("pays the investor 10% and Atlas the rest across coins and units", () => {
    const plan = planDistribution([coin(0, 500_000n), coin(1, 500_000n, 1_000_000n)], splitter, addresses);
    expect(plan.totals).toEqual({ [X402]: 1_000_000n, [MASUMI]: 1_000_000n });
    expect(plan.investors[0]!.amounts).toEqual({ [X402]: 100_000n, [MASUMI]: 100_000n });
    expect(plan.atlas.amounts).toEqual({ [X402]: 900_000n, [MASUMI]: 900_000n });
  });

  it("gives rounding dust to Atlas", () => {
    const plan = planDistribution([coin(0, 7n)], splitter, addresses);
    expect(plan.investors[0]!.amounts[X402]).toBe(0n);
    expect(plan.atlas.amounts[X402]).toBe(7n);
  });

  it("refuses batches the validator could not afford", () => {
    expect(() => planDistribution(Array.from({ length: MAX_BATCH + 1 }, (_, i) => coin(i, 1n)), splitter, addresses)).toThrow(/exceeds/);
  });
});
