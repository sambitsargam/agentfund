import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepare, sha256 } from "../src/answer.js";
import { TaskStore } from "../src/store.js";
import { CoworkerWorker, QUOTE, checkDeadlines, confirmed, netReceived, purchasePayload, type MpsPayment, type TaskState } from "../src/worker.js";

const reg = { agentIdentifier: "agent", supportedPaymentSourceIndex: 0, sellingWalletId: "w1", payoutAddress: "addr_test1seller" };
const terms = (over: Partial<MpsPayment> = {}): MpsPayment => ({
  blockchainIdentifier: "bid",
  agentIdentifier: "agent",
  inputHash: "ih",
  payByTime: "1", submitResultTime: "2", unlockTime: "3", externalDisputeUnlockTime: "4",
  sellerReturnAddress: null,
  RequestedFunds: [QUOTE],
  PaymentSource: { network: "Preprod", paymentSourceType: "Web3CardanoV2", smartContractAddress: "addr_test1escrow", policyId: "pol" },
  SmartContractWallet: { id: "w1", walletVkey: "vkey" },
  ...over,
});

describe("input handling", () => {
  it("finds the address in a chatty request", () => {
    expect(prepare("Hi, can you check addr_test1qrseuc9dfg2qdn7vkg35lxnpzjk4y67nemcmmkc2k5t2yk6ddv3uplh7wk4p468pte5fpxgckpmuu2jcuk5vr2qpgz2q7gyegt before we pay?")).toEqual({
      ok: true,
      subject: "addr_test1qrseuc9dfg2qdn7vkg35lxnpzjk4y67nemcmmkc2k5t2yk6ddv3uplh7wk4p468pte5fpxgckpmuu2jcuk5vr2qpgz2q7gyegt",
    });
  });

  it("answers a request with no address with friendly guidance", () => {
    const p = prepare("Is this wallet safe?");
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.markdown).toMatch(/addr_test1/);
  });

  it("hashes the exact UTF-8 bytes", () => {
    expect(sha256("é")).toBe("4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c");
    expect(sha256("a\nb")).not.toBe(sha256("a\r\nb"));
  });
});

describe("purchase payload", () => {
  it("passes signed fields through unchanged", () => {
    const p = purchasePayload(terms(), "nonce", reg);
    expect(p.identifierFromPurchaser).toBe("nonce");
    expect(p.Amounts).toEqual([QUOTE]);
    expect(p.PaymentSource.smartContractAddress).toBe("addr_test1escrow");
  });

  it("refuses terms for another wallet, another price or with overrides", () => {
    expect(() => purchasePayload(terms({ SmartContractWallet: { id: "w2", walletVkey: "v" } }), "n", reg)).toThrow(/seller wallet/);
    expect(() => purchasePayload(terms({ RequestedFunds: [{ ...QUOTE, amount: "2" }] }), "n", reg)).toThrow(/quote/);
    expect(() => purchasePayload(terms({ sellerReturnAddress: "addr" }), "n", reg)).toThrow(/overrides/);
  });
});

describe("settlement evidence", () => {
  it("counts only confirmed transitions", () => {
    expect(confirmed({ CurrentTransaction: { status: "Pending", newOnChainState: "FundsLocked" } }, "FundsLocked")).toBe(false);
    expect(confirmed({ TransactionHistory: [{ status: "Confirmed", newOnChainState: "FundsLocked" }] }, "FundsLocked")).toBe(true);
  });

  it("measures the net amount the payout address received", () => {
    const io = (address: string, q: string) => ({ address, amount: [{ unit: QUOTE.unit, quantity: q }] });
    expect(netReceived({ inputs: [io("addr_test1escrow", "1000000")], outputs: [io("addr_test1seller", "950000"), io("addr_test1fee", "50000")] }, "addr_test1seller", QUOTE.unit)).toBe(950000n);
  });
});

describe("unpaid task flow", () => {
  it("starts a READY task, explains bad input, and completes it", async () => {
    const posted: unknown[] = [];
    const core = {
      get: async () => [],
      post: async (_path: string, body: unknown) => {
        posted.push(body);
        return { id: `evt-${posted.length}` };
      },
    };
    const store = new TaskStore<TaskState>(mkdtempSync(join(tmpdir(), "coworker-")));
    const worker = new CoworkerWorker({ core: core as never, store, blockfrostProjectId: "x", log: () => {} });
    const id = "01a10f49-7ec1-746a-819e-a50f52e98b56";
    await worker.advance({ id, status: "READY", name: "check", description: "is this safe?" });
    expect(posted[0]).toEqual({ status: "RUNNING" });
    expect(posted[1]).toMatchObject({ status: "COMPLETED" });
    expect(store.read(id)?.stage).toBe("completed");
    expect(store.read(id)?.paid).toBe(false);
  });
});

describe("restart safety", () => {
  it("does not create another payment when a paid RUNNING Task has lost its state", async () => {
    const posted: unknown[] = [];
    const store = new TaskStore<TaskState>(mkdtempSync(join(tmpdir(), "coworker-")));
    const worker = new CoworkerWorker({
      core: { post: async (path: string) => { posted.push(path); return { id: "evt" }; } } as never,
      mps: { post: async (path: string) => { posted.push(path); return terms(); } } as never,
      registration: reg, store, blockfrostProjectId: "test", log: () => {},
    });
    const id = "01a11029-b431-74cd-945c-fac56d1fe53f";
    await worker.advance({ id, status: "RUNNING", name: "check", description: "is this safe?" });
    expect(posted).toEqual([]);
    expect(store.read(id)).toMatchObject({ stage: "needs-recovery", marketplaceStatus: "RUNNING", error: expect.stringContaining("local state is missing") });
  });

  it.each(["terms-pending", "payment-pending", "submit-pending", "complete-pending"] as const)("does not repeat an interrupted %s write", async (stage) => {
    const posted: unknown[] = [];
    const store = new TaskStore<TaskState>(mkdtempSync(join(tmpdir(), "coworker-")));
    const id = "01a11029-b431-74cd-945c-fac56d1fe53f";
    store.write(id, { taskId: id, input: "check", stage, paid: true, startedAt: "2026-10-06T00:00:00Z" });
    const worker = new CoworkerWorker({
      core: { post: async (path: string) => { posted.push(path); } } as never,
      mps: { post: async (path: string) => { posted.push(path); } } as never,
      registration: reg, store, blockfrostProjectId: "test", log: () => {},
    });
    await worker.advance({ id, status: "RUNNING", name: "check", description: "check" });
    expect(posted).toEqual([]);
    expect(store.read(id)?.stage).toBe("needs-recovery");
  });

  it("adopts a RUNNING task whose local state was lost, without re-posting RUNNING", async () => {
    const posted: unknown[] = [];
    const core = {
      get: async () => [],
      post: async (_p: string, body: unknown) => {
        posted.push(body);
        return { id: "evt" };
      },
    };
    const store = new TaskStore<TaskState>(mkdtempSync(join(tmpdir(), "coworker-")));
    const worker = new CoworkerWorker({ core: core as never, store, blockfrostProjectId: "x", log: () => {} });
    const id = "01a11029-b431-74cd-945c-fac56d1fe53f";
    await worker.advance({ id, status: "RUNNING", name: "check", description: "is this safe?" });
    expect(posted.some((p) => (p as { status?: string }).status === "RUNNING")).toBe(false);
    expect(store.read(id)).toBeDefined();
  });

  it("ignores tasks in any other state", async () => {
    const store = new TaskStore<TaskState>(mkdtempSync(join(tmpdir(), "coworker-")));
    const worker = new CoworkerWorker({ core: { get: async () => [], post: async () => ({ id: "e" }) } as never, store, blockfrostProjectId: "x", log: () => {} });
    await worker.advance({ id: "01a11029-0000-74cd-945c-fac56d1fe53f", status: "COMPLETED", name: "n", description: "d" });
    expect(store.all()).toHaveLength(0);
  });
});

describe("escrow deadlines", () => {
  it("stops waiting for an unfunded payment after its signed deadline", async () => {
    const store = new TaskStore<TaskState>(mkdtempSync(join(tmpdir(), "coworker-")));
    const id = "01a11029-b431-74cd-945c-fac56d1fe53f";
    store.write(id, { taskId: id, input: "check", stage: "awaiting-escrow", paid: true, startedAt: "2026-10-06T00:00:00Z", terms: terms({ payByTime: "100" }) });
    const worker = new CoworkerWorker({ core: {} as never, mps: { post: async () => terms({ onChainState: null }) } as never, registration: reg, store, blockfrostProjectId: "test", log: () => {}, now: () => 101 });
    await worker.advance({ id, status: "RUNNING", name: "check", description: "check" });
    expect(store.read(id)).toMatchObject({ stage: "failed", error: expect.stringContaining("did not fund escrow") });
  });

  it("accepts the defaults", () => {
    expect(() => checkDeadlines()).not.toThrow();
  });

  it("rejects an unlock less than 15 minutes after the result deadline, which Masumi refuses", () => {
    expect(() => checkDeadlines({ payBy: 15, submitResult: 35, unlock: 45, dispute: 65 })).toThrow(/15 minutes/);
  });

  it("rejects a pay-by after the result deadline and a dispute before unlock", () => {
    expect(() => checkDeadlines({ payBy: 30, submitResult: 25, unlock: 45, dispute: 65 })).toThrow(/pay-by/);
    expect(() => checkDeadlines({ payBy: 5, submitResult: 25, unlock: 45, dispute: 40 })).toThrow(/dispute/);
  });
});

it("an observer never claims a ready Task or advances a paid Task", async () => {
  const store = new TaskStore<TaskState>(mkdtempSync(join(tmpdir(), "observer-")));
  const id = "01a1135f-d2a4-727a-89aa-e049abdccab1";
  store.write(id, { taskId: id, input: "check", stage: "terms", paid: true, startedAt: new Date().toISOString() });
  const writes: unknown[] = [];
  const worker = new CoworkerWorker({ core: { get: async () => [{ id, status: "RUNNING", name: "check" }, { id: "01a1135f-85b4-7158-b2db-2271c8f49bee", status: "READY", name: "new" }], post: async (...args: unknown[]) => { writes.push(args); } } as never, mps: { post: async (...args: unknown[]) => { writes.push(args); } } as never, registration: reg, store, blockfrostProjectId: "test", log: () => {} });
  await worker.poll(true);
  expect(writes).toEqual([]);
  expect(store.read(id)?.stage).toBe("terms");
  expect(store.all()).toHaveLength(1);
});
