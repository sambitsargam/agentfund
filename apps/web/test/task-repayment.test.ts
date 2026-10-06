import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ATLAS_DEAL, ATLAS_MASUMI_PAYOUT_ADDRESS, TUSDM_MASUMI_UNIT, TUSDM_X402_UNIT } from "@agentfund/shared";
import type { BfIo, CardanoTransaction } from "../lib/cardano-activity";
import { traceTaskRepayment } from "../lib/task-repayment";

const io = (address: string, quantity: string, output_index = 0, tx_hash?: string): BfIo => ({ address, amount: [{ unit: TUSDM_MASUMI_UNIT, quantity }], output_index, tx_hash });
const receipt = { inputs: [], outputs: [io("seller", "1000000")] };
const sweep: CardanoTransaction = { tx_hash: "sweep", block_time: 2, utxos: { inputs: [io("seller", "1000000", 0, "collection")], outputs: [io("splitter", "1000000")] } };
const split: CardanoTransaction = { tx_hash: "split", block_time: 3, utxos: { inputs: [io("splitter", "1000000", 0, "sweep")], outputs: [io(ATLAS_DEAL.investors[0]!.address, "100000"), io(ATLAS_DEAL.atlasAddress, "900000", 1)] } };
const trace = (txs: CardanoTransaction[], expected = "1000000") => traceTaskRepayment("collection", receipt, txs, "seller", "splitter", expected);

describe("Task collection-to-investor evidence", () => {
  it("follows the actual verified collection, sweep and mixed-asset payout", () => {
    const evidence = JSON.parse(readFileSync(new URL("../../../docs/samples/settlement-verification.json", import.meta.url), "utf8"));
    const [collection, actualSweep, actualSplit] = evidence.transactions;
    const transactions = [actualSweep, actualSplit].map((tx: { hash: string; inputs: BfIo[]; outputs: BfIo[] }) => ({ tx_hash: tx.hash, block_time: 0, utxos: { inputs: tx.inputs, outputs: tx.outputs } }));
    const result = traceTaskRepayment(collection.hash, collection, transactions, ATLAS_MASUMI_PAYOUT_ADDRESS, actualSweep.outputs[0].address, "1000000");
    expect(result.status).toBe("distributed");
    expect(result.paths[0]?.investorPaid).toBe("100000");
    expect(result.paths[0]?.atlasPaid).toBe("900000");
    expect(result.paths[0]?.splitTx).toBe(actualSplit.hash);
  });
  it("does not use similar amounts or dates to associate unrelated payments", () => {
    const unrelated = { ...sweep, utxos: { ...sweep.utxos, inputs: [io("seller", "1000000", 0, "unrelated")] } };
    expect(trace([unrelated, split]).status).toBe("awaiting-sweep");
  });
  it("requires the exact output index", () => {
    const wrongIndex = { ...sweep, utxos: { ...sweep.utxos, inputs: [io("seller", "1000000", 1, "collection")] } };
    expect(trace([wrongIndex, split]).paths).toEqual([]);
  });
  it("does not treat reference or collateral inputs as spending the receipt", () => {
    for (const flag of ["reference", "collateral"]) {
      const other = { ...sweep, utxos: { ...sweep.utxos, inputs: [{ ...sweep.utxos.inputs[0]!, [flag]: true }] } };
      expect(trace([other, split]).status).toBe("awaiting-sweep");
    }
  });
  it("distinguishes a sweep from a confirmed investor payout", () => {
    expect(trace([sweep]).status).toBe("locked");
    expect(trace([sweep, split]).status).toBe("distributed");
  });
  it("requires both payouts in the correct asset and excludes wallet change", () => {
    const change = { ...split, utxos: { inputs: [...split.utxos.inputs, io(ATLAS_DEAL.investors[0]!.address, "100000")], outputs: split.utxos.outputs } };
    expect(trace([sweep, change]).status).toBe("locked");
    const wrongAsset = { ...split, utxos: { ...split.utxos, outputs: split.utxos.outputs.map(o => ({ ...o, amount: [{ unit: TUSDM_X402_UNIT, quantity: "1000000" }] })) } };
    expect(trace([sweep, wrongAsset]).paths[0]?.investorPaid).toBeNull();
  });
  it("rejects a mismatched collection receipt and a partial sweep", () => {
    expect(trace([sweep, split], "2000000").status).toBe("unverified");
    const partial = { ...sweep, utxos: { ...sweep.utxos, outputs: [io("splitter", "500000")] } };
    expect(trace([partial]).status).toBe("awaiting-sweep");
  });
  it("retains batch totals when another collection shares the same sweep", () => {
    const batchSweep = { ...sweep, utxos: { inputs: [...sweep.utxos.inputs, io("seller", "1000000", 0, "second-collection")], outputs: [io("splitter", "2000000")] } };
    const batchSplit = { ...split, utxos: { inputs: [io("splitter", "2000000", 0, "sweep")], outputs: [io(ATLAS_DEAL.investors[0]!.address, "200000"), io(ATLAS_DEAL.atlasAddress, "1800000", 1)] } };
    const result = trace([batchSweep, batchSplit]);
    expect(result.status).toBe("distributed");
    expect(result.paths[0]?.investorPaid).toBe("200000");
    expect(result.note).toContain("batch totals");
  });
});
