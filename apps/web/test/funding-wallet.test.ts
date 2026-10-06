import { describe, it, expect, vi } from "vitest";
import { submitFunding, type PendingFunding } from "../lib/funding-wallet";
const pending: PendingFunding = { id: "ticket", roundId: "round", action: "fund", address: "wallet", cbor: "unsigned", txHash: "hash", expiresAt: Date.now() + 600000, fee: "100", terms: { capital: "200000", bps: 5000, cap: "300000", operator: "operator" } };
function setup() {
  const saved: PendingFunding[] = [];
  const wallet = { getNetworkId: async () => 0, getChangeAddress: async () => "hex", signTx: vi.fn(async () => "witness"), submitTx: vi.fn(async (_cbor: string) => { expect(saved.at(-1)?.signedCbor).toBe("signed"); return "hash"; }) };
  const api = vi.fn(async (b: any) => b.action === "connect" ? { address: "wallet" } : { signedCbor: "signed", txHash: "hash" });
  return { saved, wallet, api, persist: (p: PendingFunding) => saved.push(p) };
}
describe("browser funding submission", () => {
  it("saves signed bytes before submission and preserves them on timeout", async () => {
    const h = setup(); h.wallet.submitTx.mockImplementation(async () => { throw new Error("timeout"); });
    await expect(submitFunding(pending, h.wallet, h.api, h.persist)).rejects.toThrow("timeout");
    expect(h.saved).toHaveLength(1); expect(h.saved[0]?.signedCbor).toBe("signed");
  });
  it("resubmits identical bytes after restart without signing again", async () => {
    const h = setup(); const restored = { ...pending, signedCbor: "signed" }; h.saved.push(restored);
    await submitFunding(restored, h.wallet, h.api, h.persist);
    expect(h.wallet.signTx).not.toHaveBeenCalled(); expect(h.wallet.submitTx).toHaveBeenCalledWith("signed"); expect(h.saved.at(-1)?.submitted).toBe(true);
  });
  it("rejects a switched wallet account before signing or broadcasting", async () => {
    const h = setup(); h.api.mockResolvedValue({ address: "someone-else" } as never);
    await expect(submitFunding(pending, h.wallet, h.api, h.persist)).rejects.toThrow(/different wallet/); expect(h.wallet.signTx).not.toHaveBeenCalled(); expect(h.wallet.submitTx).not.toHaveBeenCalled();
  });
  it("never signs an expired proposal", async () => {
    const h = setup(); await expect(submitFunding({ ...pending, expiresAt: 0 }, h.wallet, h.api, h.persist)).rejects.toThrow(/expired/); expect(h.wallet.signTx).not.toHaveBeenCalled();
  });
  it("refuses mainnet", async () => {
    const h = setup(); h.wallet.getNetworkId = async () => 1;
    await expect(submitFunding(pending, h.wallet, h.api, h.persist)).rejects.toThrow(/preprod/); expect(h.wallet.submitTx).not.toHaveBeenCalled();
  });
});
