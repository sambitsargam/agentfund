import { describe, expect, it } from "vitest";
import { ATLAS_DEAL, TUSDM_MASUMI_UNIT, TUSDM_X402_UNIT } from "@agentfund/shared";
import { allPages, summarizeCardano, type BfIo } from "../lib/cardano-activity";

const io = (address: string, x402 = "0", masumi = "0", extra: Partial<BfIo> = {}): BfIo => ({
  address, amount: [{ unit: TUSDM_X402_UNIT, quantity: x402 }, { unit: TUSDM_MASUMI_UNIT, quantity: masumi }], ...extra,
});
const atlas = ATLAS_DEAL.atlasAddress;
const investor = ATLAS_DEAL.investors[0]!.address;

describe("Cardano dashboard accounting", () => {
  it("loads activity beyond the first page instead of dropping old payments", async () => {
    const values = Array.from({ length: 205 }, (_, i) => i);
    const pages: number[] = [];
    const result = await allPages(async (page) => { pages.push(page); return values.slice((page - 1) * 100, page * 100); });
    expect(pages).toEqual([1, 2, 3]);
    expect(result).toEqual(values);
  });

  it("keeps mixed-asset income separate and excludes wallet change from repayment", () => {
    const paid = io("splitter", "500000", "1000000", { output_index: 0 });
    const receipt = { ...paid, tx_hash: "payment" };
    const activity = summarizeCardano([
      { tx_hash: "payment", block_time: 1, utxos: { inputs: [], outputs: [paid] } },
      { tx_hash: "split", block_time: 2, utxos: {
        inputs: [receipt, io(investor, "200000"), io(atlas, "300000")],
        outputs: [io(investor, "250000", "100000"), io(atlas, "750000", "900000")],
      } },
    ], [], "splitter");
    expect(activity.earnedX402).toBe("500000");
    expect(activity.earnedMasumi).toBe("1000000");
    expect(activity.repaidToInvestor).toBe("150000");
    expect(activity.splits[0]?.atlas).toBe("1350000");
    expect(activity.payments.every((p) => p.splitTx === "split")).toBe(true);
    expect(activity.lockedNow).toBe("0");
  });

  it("reads locked funds from current UTxOs rather than incomplete historical spend links", () => {
    const activity = summarizeCardano([], [io("splitter", "500000", "1000000")], "splitter");
    expect(activity.lockedNow).toBe("1500000");
  });
});
