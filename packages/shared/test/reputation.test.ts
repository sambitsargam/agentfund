import { describe, expect, it } from "vitest";
import { ATLAS_MASUMI_PAYOUT_ADDRESS, MASUMI_REGISTRY_POLICY, detectRegisteredAgent, lookupPublicReputation } from "../src/index.js";
import data from "../src/data/public-threats.json";

describe("external threat associations", () => {
  it("preserves provenance for every distinct listed address", () => {
    expect(new Set(data.rows.map(r => r.address)).size).toBe(data.rows.length);
    for (const row of data.rows) expect(lookupPublicReputation(row.address)).toMatchObject({ listed: true, sources: [row.source], sourceCommit: data.sourceCommit });
  });
  it("never labels an unlisted address safe or maps a preprod key onto a mainnet address", () => {
    const r = lookupPublicReputation(ATLAS_MASUMI_PAYOUT_ADDRESS);
    expect(r.listed).toBe(false); expect(r.meaning).toContain("does not establish safety");
  });
  it("matches exact addresses, not prefixes", () => {
    expect(lookupPublicReputation(data.rows[0]!.address.slice(0, -1)).listed).toBe(false);
  });
});
describe("funded identity is bound to a configured wallet", () => {
  const chain = { blockfrost: async (path: string) => path.startsWith("/addresses/")
    ? { amount: [{ unit: MASUMI_REGISTRY_POLICY + "0000", quantity: "1" }] }
    : { onchain_metadata: { name: "Atlas — Cardano wallet check", author: "An unverified name" } } };
  it("does not give a same-name registration someone else's funded status", async () => {
    const r = await detectRegisteredAgent("another-wallet", chain as never);
    expect(r?.name).toBe("Atlas — Cardano wallet check"); expect(r?.fundedAgentId).toBeNull();
  });
  it("uses the configured address binding rather than registration claims", async () => {
    expect((await detectRegisteredAgent(ATLAS_MASUMI_PAYOUT_ADDRESS, chain as never))?.fundedAgentId).toBe("atlas");
  });
});
