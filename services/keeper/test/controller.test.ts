import { describe, expect, it } from "vitest";
import { keeperTick, type KeeperState } from "../src/controller.js";

function harness(initial: Partial<KeeperState> = {}) {
  let state: KeeperState = { stage: "idle", cycles: 0, updatedAt: "now", ...initial };
  const calls: string[] = [], saved: string[] = [];
  const deps = { read: () => state, save: (s: KeeperState) => { state = structuredClone(s); saved.push(s.stage); }, now: () => "later",
    run: async (action: "sweep" | "distribute") => { calls.push(action); return { hash: action === "sweep" ? "a" : "b", empty: false }; }, confirmed: async (_hash: string) => false };
  return { deps, calls, saved, state: () => state };
}
describe("keeper restart and confirmation safety", () => {
  it("waits for sweep confirmation before spending the contract", async () => {
    const h = harness(); await keeperTick(h.deps);
    expect(h.calls).toEqual(["sweep"]); expect(h.saved).toEqual(["sweeping", "sweep-submitted"]);
    h.deps.confirmed = async () => true; await keeperTick(h.deps);
    expect(h.calls).toEqual(["sweep", "distribute"]); expect(h.state()).toMatchObject({ stage: "idle", cycles: 1, splitTx: "b" });
  });
  it.each(["sweeping", "distributing"] as const)("blocks uncertain %s after a restart without signing again", async stage => {
    const h = harness({ stage }); await keeperTick(h.deps); expect(h.calls).toEqual([]); expect(h.state().stage).toBe("blocked");
  });
  it("resumes a known distribution by checking its hash only", async () => {
    const h = harness({ stage: "split-submitted", splitTx: "b" }); h.deps.confirmed = async () => true;
    await keeperTick(h.deps); expect(h.calls).toEqual([]); expect(h.state().cycles).toBe(1);
  });
  it("retains a known submission when the indexer fails", async () => {
    const h = harness({ stage: "sweep-submitted", sweepTx: "a" }); h.deps.confirmed = async () => { throw new Error("offline"); };
    await keeperTick(h.deps); expect(h.state().stage).toBe("sweep-submitted"); expect(h.calls).toEqual([]);
  });
  it("halts after a command with an ambiguous outcome", async () => {
    const h = harness(); h.deps.run = async () => { throw new Error("submit timeout"); };
    await keeperTick(h.deps); expect(h.state().stage).toBe("blocked"); await keeperTick(h.deps); expect(h.calls).toEqual([]);
  });
  it("does not fabricate a transaction when both wallets are empty", async () => {
    const h = harness(); h.deps.run = async () => ({ hash: undefined as unknown as string, empty: true });
    await keeperTick(h.deps); expect(h.state()).toMatchObject({ stage: "idle", cycles: 1 }); expect(h.state().splitTx).toBeUndefined();
  });
});
