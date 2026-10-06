import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { Address, Assets, InlineDatum, TransactionHash } from "@evolution-sdk/evolution";
import { ATLAS_DEAL, ATLAS_ROUND_TERMS } from "@agentfund/shared";
import { buildRound, buildSplitter, RoundStore, ROUND_MARKER, stateData, type RoundState, type RoundConfig } from "@agentfund/cardano-tx";
import { roundRoutes } from "../src/round-routes.js";
const dirs: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); dirs.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })); });
function setup(state: RoundState | null, unavailable = false) {
  const dir = mkdtempSync(join(tmpdir(), "round-route-")); dirs.push(dir);
  const db = new RoundStore(dir);
  const c: RoundConfig = { id: "draft", agent: "atlas", service: "recipient-check", terms: ATLAS_ROUND_TERMS, seed: { txHash: "a".repeat(64), index: 0 } };
  const script = buildRound(c); c.id = script.hash; db.write("rounds", c.id, c);
  const coin = state ? { address: Address.fromBech32(script.address), assets: Assets.addByHex(Assets.fromLovelace(5_000_000n), script.hash, ROUND_MARKER, 1n), transactionId: TransactionHash.fromHex("b".repeat(64)), index: 0n, datumOption: new InlineDatum.InlineDatum({ data: stateData(state) }) } : null;
  const client = { getUtxos: async () => { if (unavailable) throw new Error("offline"); return coin ? [coin] : []; }, newTx: () => { throw new Error("Read only"); } };
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ kinds: [{ x402Version: 2, scheme: "exact", network: "cardano:preprod", extra: { assetTransferMethods: ["script"], l1Confirmations: { minimum: 0, maximum: 20 } } }], extensions: [], signers: {} })));
  const app = express(); app.use("/rounds", roundRoutes({ splitter: buildSplitter(ATLAS_DEAL), facilitatorUrl: "http://facilitator.test", blockfrostProjectId: "test", publicUrl: "https://atlas.test" }, client as never, db));
  return { app, script, c, db, url: `/rounds/${c.id}/report?address=${ATLAS_DEAL.atlasAddress}` };
}
describe("round-specific customer payment routing", () => {
  it.each([null, { stage: "offered" }, { stage: "cancelled" }] as (RoundState | null)[])("refuses payment before authenticated funding: %j", async state => {
    const h = setup(state); const res = await request(h.app).get(h.url); expect(res.status).toBe(409); expect(res.headers["payment-required"]).toBeUndefined();
  });
  it.each(["active", "closed"] as const)("binds the real x402 offer to the %s round script", async stage => {
    const h = setup({ stage, investor: ATLAS_DEAL.investors[0]!.address, earned: stage === "closed" ? "1000000" : "0", paid: stage === "closed" ? "300000" : "0" });
    const res = await request(h.app).get(h.url); expect(res.status).toBe(402);
    const req = JSON.parse(Buffer.from(String(res.headers["payment-required"]), "base64").toString()).accepts[0];
    expect(req.payTo).toBe(h.script.address); expect(req.extra.script.code).toBe(h.script.code); expect(req.amount).toBe("500000");
  });
  it("fails closed during a provider outage", async () => {
    const h = setup(null, true); expect((await request(h.app).get(h.url)).status).toBe(503);
  });
  it("does not serve a round for a different agent", async () => {
    const h = setup({ stage: "offered" }); h.c.agent = "other"; h.db.write("rounds", h.c.id, h.c);
    expect((await request(h.app).get(h.url)).status).toBe(409);
  });
});
