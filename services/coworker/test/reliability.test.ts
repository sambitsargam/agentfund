import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TaskStore } from "../src/store.js";
import { CoworkerWorker, QUOTE, type TaskState, type MpsPayment } from "../src/worker.js";
import { summarizeReliability } from "../src/reliability.js";

describe("paid lifecycle under repeated restarts (simulated services)", () => {
  it("completes 100 separate paid Tasks with exactly one purchase, result and completion each", async () => {
    const store = new TaskStore<TaskState>(mkdtempSync(join(tmpdir(), "atlas-reliability-")));
    const reg = { agentIdentifier: "agent", supportedPaymentSourceIndex: 0, sellingWalletId: "w", payoutAddress: "seller" };
    const now = Date.now(); let purchases = 0, completions = 0, results = 0, reportCalls = 0;
    const txHash = "a".repeat(64);
    const terms = (id: string): MpsPayment => ({ blockchainIdentifier: id, agentIdentifier: "agent", inputHash: "input", payByTime: String(now + 1000000), submitResultTime: String(now + 2000000), unlockTime: String(now + 3000000), externalDisputeUnlockTime: String(now + 4000000),
      RequestedFunds: [QUOTE], PaymentSource: { network: "Preprod", paymentSourceType: "Web3CardanoV2", smartContractAddress: "escrow", policyId: "p" }, SmartContractWallet: { id: "w", walletVkey: "v" } });
    const core = { post: async (_path: string, body: any) => { if (body.masumiPayment) purchases++; if (body.status === "COMPLETED") completions++; return { id: "event" }; },
      get: async (path: string) => { const id = path.split("/")[3]!; return { settled: true, txHash, blockchainIdentifier: id }; } };
    let currentTask = "";
    const mps = { post: async (path: string) => {
      const s = store.read(currentTask)!;
      if (path === "/api/v1/payment") return terms(currentTask);
      if (path.endsWith("submit-result")) { results++; return {}; }
      const state = s.stage === "awaiting-escrow" ? "FundsLocked" : s.stage === "awaiting-result" ? "ResultSubmitted" : "Withdrawn";
      return { ...terms(currentTask), onChainState: state, resultHash: s.resultHash, CurrentTransaction: { status: "Confirmed", newOnChainState: state, txHash } };
    } };
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ inputs: [], outputs: [{ address: "seller", amount: [{ unit: QUOTE.unit, quantity: "1000000" }] }] }), { status: 200 }));
    try {
      for (let n = 0; n < 100; n++) {
        const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`; currentTask = id;
        for (let tick = 0; tick < 5; tick++) {
          // New worker instance on every tick, retaining only durable Task files.
          const w = new CoworkerWorker({ core: core as never, mps: mps as never, registration: reg, store, blockfrostProjectId: "test", log: () => {}, now: () => now,
            answer: async () => { reportCalls++; return { markdown: "Simulated report", delivered: true }; } });
          await w.advance({ id, status: tick === 0 ? "READY" : "RUNNING", description: "addr_test1qrseuc9dfg2qdn7vkg35lxnpzjk4y67nemcmmkc2k5t2yk6ddv3uplh7wk4p468pte5fpxgckpmuu2jcuk5vr2qpgz2q7gyegt", name: "check" });
        }
        expect(store.read(id)).toMatchObject({ stage: "settled", delivered: true, settlement: { verified: true } });
      }
      expect({ purchases, completions, results, reportCalls }).toEqual({ purchases: 100, completions: 100, results: 100, reportCalls: 100 });
      expect(summarizeReliability(store.all().map(t => t.state), now)).toMatchObject({ paidTasksSeen: 100, paidCollectionsVerified: 100, paidTasksFailed: 0 });
    } finally { vi.unstubAllGlobals(); }
  });
  it("reports failures and pending Tasks rather than hiding them from the denominator", () => {
    const base = { taskId: "id", input: "private", paid: true, startedAt: "date" };
    const r = summarizeReliability([{ ...base, stage: "settled", settlement: { verified: true, txHash: "hash" } }, { ...base, stage: "failed" }, { ...base, stage: "awaiting-escrow" }] as TaskState[]);
    expect(r).toMatchObject({ paidTasksSeen: 3, paidCollectionsVerified: 1, paidTasksFailed: 1, paidTasksOngoing: 1, successFractionAmongTerminal: 0.5 });
    expect(JSON.stringify(r)).not.toContain("private");
  });
});
