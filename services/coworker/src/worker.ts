import { randomBytes } from "node:crypto";
import { TUSDM_MASUMI_UNIT } from "@agentfund/shared";
import { CoreClient, MpsClient } from "./clients.js";
import { answer, prepare, sha256 } from "./answer.js";
import { TaskStore } from "./store.js";

const MINUTE = 60_000;

/**
 * Preprod deadlines, in minutes from when terms are signed. The buyer is Sokosumi Core, which
 * funds escrow asynchronously; a 5-minute window expired before it paid, so `payBy` is generous.
 * `unlock` is what gates collection, so it stays as early as the other deadlines allow.
 */
export const DEADLINES = {
  payBy: Number(process.env.MASUMI_PAY_BY_MINUTES ?? 15),
  submitResult: Number(process.env.MASUMI_RESULT_MINUTES ?? 25),
  unlock: Number(process.env.MASUMI_UNLOCK_MINUTES ?? 40),
  dispute: Number(process.env.MASUMI_DISPUTE_MINUTES ?? 60),
};

/** Masumi's own minimum: unlock must be at least 15 minutes after the result deadline. */
export const MIN_UNLOCK_GAP = 15;

export function checkDeadlines(d: typeof DEADLINES = DEADLINES): void {
  if (!(d.payBy < d.submitResult)) throw new Error("pay-by must come before the result deadline");
  if (d.unlock - d.submitResult < MIN_UNLOCK_GAP) {
    throw new Error(`unlock must be at least ${MIN_UNLOCK_GAP} minutes after the result deadline`);
  }
  if (!(d.dispute > d.unlock)) throw new Error("the dispute deadline must come after unlock");
}
export const QUOTE = { amount: "1000000", unit: TUSDM_MASUMI_UNIT }; // 1 tUSDM per check

export interface Registration {
  agentIdentifier: string;
  supportedPaymentSourceIndex: number;
  sellingWalletId: string;
  /** Where escrow payouts land: the seller wallet, or the splitter when collection points there. */
  payoutAddress: string;
}

export type Stage =
  | "new"
  | "terms-pending"
  | "terms"
  | "payment-pending"
  | "awaiting-escrow"
  | "result-saved"
  | "submit-pending"
  | "awaiting-result"
  | "complete-ready"
  | "complete-pending"
  | "completed"
  | "awaiting-withdrawal"
  | "settled"
  | "failed";

export interface TaskState {
  taskId: string;
  input: string;
  stage: Stage;
  paid: boolean;
  startedAt: string;
  nonce?: string;
  terms?: MpsPayment;
  purchaseEventId?: string;
  result?: string;
  resultHash?: string;
  delivered?: boolean;
  completionEventId?: string;
  onChainState?: string;
  settlement?: Settlement;
  error?: string;
  updatedAt?: string;
}

interface MpsTx {
  status?: string;
  newOnChainState?: string;
  txHash?: string;
}

export interface MpsPayment {
  blockchainIdentifier: string;
  agentIdentifier: string;
  inputHash: string;
  payByTime: string;
  submitResultTime: string;
  unlockTime: string;
  externalDisputeUnlockTime: string;
  sellerReturnAddress?: string | null;
  forceLayer?: string | null;
  onChainState?: string | null;
  resultHash?: string | null;
  RequestedFunds: { amount: string; unit: string }[];
  PaymentSource: { network: string; paymentSourceType: string; smartContractAddress: string; policyId: string };
  SmartContractWallet: { id: string; walletVkey: string; walletAddress?: string };
  CurrentTransaction?: MpsTx | null;
  TransactionHistory?: MpsTx[];
}

export interface Settlement {
  verified: boolean;
  txHash?: string;
  netAtomicUnits?: string;
  reason?: string;
}

interface CoreTask {
  id: string;
  status: string;
  description: string | null;
  name: string;
  assigneeId?: string;
}

export function confirmed(p: Pick<MpsPayment, "CurrentTransaction" | "TransactionHistory">, state: string): boolean {
  const ok = (t?: MpsTx | null) => t?.status === "Confirmed" && t.newOnChainState === state;
  return ok(p.CurrentTransaction) || (p.TransactionHistory ?? []).some(ok);
}

/** The buyer-side purchase request Core relays to Masumi; every signed field is passed through unchanged. */
export function purchasePayload(p: MpsPayment, nonce: string, reg: Registration) {
  if (p.sellerReturnAddress != null || p.forceLayer != null) {
    throw new Error("signed terms carry overrides Core cannot preserve");
  }
  if (p.PaymentSource.network !== "Preprod" || p.PaymentSource.paymentSourceType !== "Web3CardanoV2") {
    throw new Error("payment source is not Preprod Web3CardanoV2");
  }
  if (p.SmartContractWallet.id !== reg.sellingWalletId) throw new Error("signed terms name a different seller wallet");
  const [funds] = p.RequestedFunds;
  if (p.RequestedFunds.length !== 1 || funds?.unit !== QUOTE.unit || funds.amount !== QUOTE.amount) {
    throw new Error("signed quote differs from 1 tUSDM");
  }
  return {
    blockchainIdentifier: p.blockchainIdentifier,
    agentIdentifier: p.agentIdentifier,
    sellerVkey: p.SmartContractWallet.walletVkey,
    submitResultTime: p.submitResultTime,
    payByTime: p.payByTime,
    unlockTime: p.unlockTime,
    externalDisputeUnlockTime: p.externalDisputeUnlockTime,
    inputHash: p.inputHash,
    identifierFromPurchaser: nonce,
    paymentSourceType: "Web3CardanoV2",
    supportedPaymentSourceIndex: reg.supportedPaymentSourceIndex,
    Amounts: p.RequestedFunds.map(({ amount, unit }) => ({ amount, unit })),
    PaymentSource: { network: "Preprod", smartContractAddress: p.PaymentSource.smartContractAddress, policyId: p.PaymentSource.policyId },
  };
}

export interface WorkerDeps {
  core: CoreClient;
  mps?: MpsClient;
  registration?: Registration;
  store: TaskStore<TaskState>;
  blockfrostProjectId: string;
  log: (msg: string) => void;
  now?: () => number;
}

export class CoworkerWorker {
  lastPollAt?: string;
  private readonly now: () => number;

  constructor(private readonly deps: WorkerDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  get paidEnabled(): boolean {
    return Boolean(this.deps.mps && this.deps.registration);
  }

  async poll(): Promise<void> {
    const tasks = await this.deps.core.get<CoreTask[]>("/v1/tasks?limit=50");
    this.lastPollAt = new Date(this.now()).toISOString();
    for (const task of tasks) {
      try {
        await this.advance(task);
      } catch (err) {
        this.deps.log(`task ${task.id}: ${(err as Error).message}`);
      }
    }
  }

  private save(state: TaskState): TaskState {
    return this.deps.store.write(state.taskId, { ...state, updatedAt: new Date(this.now()).toISOString() });
  }

  async advance(task: CoreTask): Promise<void> {
    let state = this.deps.store.read(task.id);
    if (!state) {
      // READY: ours to start. RUNNING with no state: we started it and lost the file, so adopt it
      // rather than leaving the Task stranded. Anything else is not ours to touch.
      if (task.status !== "READY" && task.status !== "RUNNING") return;
      state = this.save({
        taskId: task.id,
        input: task.description ?? task.name,
        stage: "new",
        paid: this.paidEnabled,
        startedAt: new Date(this.now()).toISOString(),
      });
      if (task.status === "READY") {
        await this.deps.core.post(`/v1/tasks/${task.id}/events`, { status: "RUNNING" });
        this.deps.log(`task ${task.id}: started (${state.paid ? "paid" : "unpaid"})`);
      } else {
        this.deps.log(`task ${task.id}: adopted an in-flight Task (${state.paid ? "paid" : "unpaid"})`);
      }
    }
    // Several steps can complete in one tick; stop when a step is waiting on someone else.
    for (let i = 0; i < 8; i++) {
      const next = await this.step(state);
      if (next.stage === state.stage) return;
      state = next;
    }
  }

  private async step(s: TaskState): Promise<TaskState> {
    const { core, mps, registration } = this.deps;
    switch (s.stage) {
      case "new": {
        const prepared = prepare(s.input);
        if (!prepared.ok) {
          // Nothing to check: explain what to send instead, and do not charge for it.
          return this.save({ ...s, paid: false, stage: "result-saved", result: prepared.markdown, resultHash: sha256(prepared.markdown), delivered: false });
        }
        if (!s.paid) {
          const a = await answer(prepared.subject, this.deps.blockfrostProjectId);
          return this.save({ ...s, stage: "result-saved", result: a.markdown, resultHash: sha256(a.markdown), delivered: a.delivered });
        }
        checkDeadlines();
        const nonce = randomBytes(10).toString("hex");
        const now = this.now();
        const request = {
          network: "Preprod",
          agentIdentifier: registration!.agentIdentifier,
          paymentSourceType: "Web3CardanoV2",
          supportedPaymentSourceIndex: registration!.supportedPaymentSourceIndex,
          inputHash: sha256(s.input),
          identifierFromPurchaser: nonce,
          RequestedFunds: [QUOTE],
          payByTime: new Date(now + DEADLINES.payBy * MINUTE).toISOString(),
          submitResultTime: new Date(now + DEADLINES.submitResult * MINUTE).toISOString(),
          unlockTime: new Date(now + DEADLINES.unlock * MINUTE).toISOString(),
          externalDisputeUnlockTime: new Date(now + DEADLINES.dispute * MINUTE).toISOString(),
          metadata: JSON.stringify({ taskId: s.taskId }),
        };
        this.save({ ...s, stage: "terms-pending", nonce });
        const terms = await mps!.post<MpsPayment>("/api/v1/payment", request);
        return this.save({ ...s, stage: "terms", nonce, terms });
      }
      case "terms": {
        const payload = purchasePayload(s.terms!, s.nonce!, registration!);
        if (this.now() >= Number(s.terms!.payByTime)) return this.fail(s, "signed payment deadline passed before the purchase was sent");
        this.save({ ...s, stage: "payment-pending" });
        const event = await core.post<{ id: string }>(`/v1/tasks/${s.taskId}/events`, {
          comment: "Atlas will check this address once the 1 tUSDM payment is held in escrow.",
          masumiPayment: payload,
        });
        return this.save({ ...s, stage: "awaiting-escrow", purchaseEventId: event.id });
      }
      case "awaiting-escrow": {
        const observed = await this.observe(s);
        if (observed.onChainState !== "FundsLocked" || !confirmed(observed, "FundsLocked")) {
          // Past the signed pay-by time with nothing locked: the buyer never funded it, and no
          // later payment can satisfy these terms. Stop rather than poll a dead payment forever.
          if (this.now() >= Number(s.terms!.payByTime) && !observed.onChainState) {
            return this.fail(s, "the buyer did not fund escrow before the signed pay-by time");
          }
          return this.save({ ...s, onChainState: observed.onChainState ?? undefined });
        }
        if (this.now() >= Number(s.terms!.submitResultTime)) return this.fail(s, "result deadline passed before escrow confirmed");
        const prepared = prepare(s.input);
        const a = prepared.ok ? await answer(prepared.subject, this.deps.blockfrostProjectId) : { markdown: prepared.markdown, delivered: false };
        return this.save({ ...s, stage: "result-saved", onChainState: "FundsLocked", result: a.markdown, resultHash: sha256(a.markdown), delivered: a.delivered });
      }
      case "result-saved": {
        if (!s.paid) return this.save({ ...s, stage: "complete-ready" });
        if (this.now() >= Number(s.terms!.submitResultTime)) return this.fail(s, "result deadline passed before submission");
        this.save({ ...s, stage: "submit-pending" });
        await mps!.post("/api/v1/payment/submit-result", {
          network: "Preprod",
          blockchainIdentifier: s.terms!.blockchainIdentifier,
          submitResultHash: s.resultHash,
        });
        return this.save({ ...s, stage: "awaiting-result" });
      }
      case "awaiting-result": {
        const observed = await this.observe(s);
        const done = observed.onChainState === "ResultSubmitted" && observed.resultHash === s.resultHash && confirmed(observed, "ResultSubmitted");
        return this.save({ ...s, onChainState: observed.onChainState ?? undefined, ...(done ? { stage: "complete-ready" as const } : {}) });
      }
      case "complete-ready": {
        this.save({ ...s, stage: "complete-pending" });
        const event = await core.post<{ id: string }>(`/v1/tasks/${s.taskId}/events`, { status: "COMPLETED", comment: s.result });
        this.deps.log(`task ${s.taskId}: completed`);
        return this.save({ ...s, stage: s.paid ? "awaiting-withdrawal" : "completed", completionEventId: event.id });
      }
      case "awaiting-withdrawal": {
        const observed = await this.observe(s);
        if (!["Withdrawn", "DisputedWithdrawn"].includes(observed.onChainState ?? "")) return this.save({ ...s, onChainState: observed.onChainState ?? undefined });
        const settlement = await this.verifySettlement(s, observed);
        return this.save({ ...s, onChainState: observed.onChainState ?? undefined, settlement, ...(settlement.verified ? { stage: "settled" as const } : {}) });
      }
      case "terms-pending":
      case "payment-pending":
      case "submit-pending":
      case "complete-pending":
        // The previous run stopped mid-write; its outcome is unknown, so a person checks before anything is retried.
        return this.fail(s, `interrupted during ${s.stage}; inspect the Task and payment before retrying`);
      default:
        return s;
    }
  }

  private fail(s: TaskState, error: string): TaskState {
    this.deps.log(`task ${s.taskId}: ${error}`);
    return this.save({ ...s, stage: "failed", error });
  }

  private async observe(s: TaskState): Promise<MpsPayment> {
    return this.deps.mps!.post<MpsPayment>("/api/v1/payment/resolve-blockchain-identifier", {
      network: "Preprod",
      blockchainIdentifier: s.terms!.blockchainIdentifier,
      includeHistory: "true",
    });
  }

  /** Seller receipt is proven only by the withdrawal transaction paying the payout address, checked on-chain. */
  private async verifySettlement(s: TaskState, observed: MpsPayment): Promise<Settlement> {
    const receipt = await this.deps.core.get<{ settled?: boolean; txHash?: string; blockchainIdentifier?: string }>(`/v1/tasks/${s.taskId}/receipt`);
    if (!receipt.settled || !receipt.txHash) return { verified: false, reason: "Core receipt not settled yet" };
    if (receipt.blockchainIdentifier !== observed.blockchainIdentifier) return { verified: false, reason: "receipt names a different payment" };
    const withdrawal = [observed.CurrentTransaction, ...(observed.TransactionHistory ?? [])].find(
      (t) => t?.status === "Confirmed" && ["Withdrawn", "DisputedWithdrawn"].includes(t.newOnChainState ?? "") && t.txHash === receipt.txHash,
    );
    if (!withdrawal) return { verified: false, txHash: receipt.txHash, reason: "MPS has not confirmed this withdrawal" };
    const res = await fetch(`https://cardano-preprod.blockfrost.io/api/v0/txs/${receipt.txHash}/utxos`, {
      headers: { project_id: this.deps.blockfrostProjectId },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { verified: false, txHash: receipt.txHash, reason: `Blockfrost ${res.status}` };
    const utxos = (await res.json()) as { inputs: Io[]; outputs: Io[] };
    const net = netReceived(utxos, this.deps.registration!.payoutAddress, QUOTE.unit);
    return { verified: net > 0n, txHash: receipt.txHash, netAtomicUnits: net.toString() };
  }
}

interface Io {
  address: string;
  amount: { unit: string; quantity: string }[];
}

export function netReceived(utxos: { inputs: Io[]; outputs: Io[] }, address: string, unit: string): bigint {
  const sum = (ios: Io[]) =>
    ios.filter((x) => x.address === address).reduce((t, x) => t + x.amount.filter((a) => a.unit === unit).reduce((n, a) => n + BigInt(a.quantity), 0n), 0n);
  return sum(utxos.outputs) - sum(utxos.inputs);
}
