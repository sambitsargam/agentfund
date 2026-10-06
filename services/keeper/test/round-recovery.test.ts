import { describe, expect, it, vi } from "vitest";
import { resolvePending } from "../src/round-recovery.js";
const pending = { action: "fund", at: "now", txHash: "a".repeat(64) };
describe("round submission recovery", () => {
  it("never clears an ambiguous legacy submission without an exact hash", async () => {
    const check = vi.fn(); await expect(resolvePending({ action: "fund", at: "now" }, check)).rejects.toThrow(/manual/); expect(check).not.toHaveBeenCalled();
  });
  it("retains the pending action when the exact hash is not indexed", async () => {
    await expect(resolvePending(pending, async () => false)).rejects.toThrow(/retained/);
  });
  it("does not turn provider failure into permission to retry", async () => {
    await expect(resolvePending(pending, async () => { throw new Error("offline"); })).rejects.toThrow("offline");
  });
  it("adopts only its exact confirmed transaction", async () => {
    const check = vi.fn(async () => true); expect(await resolvePending(pending, check)).toBe(pending.txHash); expect(check).toHaveBeenCalledTimes(1); expect(check).toHaveBeenCalledWith(pending.txHash);
  });
});
