import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepare, sha256 } from "../src/answer.js";
import { TaskStore } from "../src/store.js";
import { CoworkerWorker, QUOTE, confirmed, netReceived, purchasePayload, type MpsPayment, type TaskState } from "../src/worker.js";

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
