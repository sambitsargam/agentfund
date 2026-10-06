import { describe, expect, it } from "vitest";
import { fundingMatches } from "../src/funding-proof.js";
const io = (address: string, quantity: string, extra = {}) => ({ address, amount: [{ unit: "lovelace", quantity }], ...extra });
const terms = { investor: "investor", recipient: "atlas", lovelace: 2_000_000n, digest: "reviewed-terms" };
function proof() { return { tx: { block_height: 10 }, utxos: { inputs: [io("investor", "5000000")], outputs: [io("atlas", "2000000"), io("investor", "2800000")] }, metadata: [{ label: "674", json_metadata: ["AgentFund seed round", terms.digest] }] }; }
describe("capital evidence", () => {
  it("accepts confirmed investor-funded net capital with the reviewed terms", () => { expect(fundingMatches(proof(), terms)).toBe(true); });
  it("rejects an unconfirmed transaction", () => { const p = proof(); p.tx.block_height = 0; expect(fundingMatches(p, terms)).toBe(false); });
  it("rejects a different funder and reference-only investor participation", () => { const p = proof(); p.utxos.inputs = [io("other", "5000000"), io("investor", "5000000", { reference: true })]; expect(fundingMatches(p, terms)).toBe(false); });
  it("checks net received capital rather than gross outputs", () => { const p = proof(); p.utxos.inputs.push(io("atlas", "1000000")); expect(fundingMatches(p, terms)).toBe(false); });
  it("does not treat collateral returns as operating capital", () => { const p = proof(); p.utxos.outputs = [io("atlas", "2000000", { collateral: true })]; expect(fundingMatches(p, terms)).toBe(false); });
  it("rejects wrong metadata labels or another round's digest", () => { const p = proof(); p.metadata[0]!.json_metadata = ["other-terms"]; expect(fundingMatches(p, terms)).toBe(false); p.metadata = [{ label: "675", json_metadata: [terms.digest] }]; expect(fundingMatches(p, terms)).toBe(false); });
});
