import "server-only";
import { createPublicClient, http, keccak256, parseAbi, parseAbiItem, stringToBytes, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { ATLAS_DEAL, BLOCKFROST_PREPROD_URL, TUSDM_MASUMI_UNIT, TUSDM_X402_UNIT } from "@agentfund/shared";

export const REGISTRY = "0xee171354e30f24428eEaAaDA952eEC7479b08131" as const;
const REGISTRY_FROM_BLOCK = 47_745_260n;
export const SPLITTER = "addr_test1wzyukctzs3agkmx9gt85dp2ftu9622k8926qh7kjhlw3z8s7w0h96";
export const ATLAS_ID = keccak256(stringToBytes(ATLAS_DEAL.agentId));
export const COWORKER_ID = "01a10f48-cd2e-7408-b1f2-493af98854af";

// sepolia.base.org caps eth_getLogs at 500 blocks; publicnode serves the full range.
const base = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC ?? "https://base-sepolia-rpc.publicnode.com") });
const fallback = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_FALLBACK ?? "https://base-sepolia.drpc.org") });
const CHUNK = 9_999n;

/** Full-range log query, falling back to chunked queries on a provider with a range cap. */
async function logs<T>(query: (client: typeof base, fromBlock: bigint, toBlock?: bigint) => Promise<T[]>): Promise<T[]> {
  try {
    return await query(base, REGISTRY_FROM_BLOCK);
  } catch {
    const head = await fallback.getBlockNumber();
    const out: T[] = [];
    for (let from = REGISTRY_FROM_BLOCK; from <= head; from += CHUNK + 1n) {
      const to = from + CHUNK > head ? head : from + CHUNK;
      out.push(...(await query(fallback, from, to)));
    }
    return out;
  }
}

const registryAbi = parseAbi([
  "function getRating(bytes32 agentId) view returns ((uint16 score, uint256 earnings, uint32 paymentCount, bool probeOk, uint32 latencyMs, uint64 observedAt))",
]);
const ratingEvent = parseAbiItem(
  "event RatingUpdated(bytes32 indexed agentId, uint16 score, uint256 earnings, uint32 paymentCount, bool probeOk, uint32 latencyMs, uint64 observedAt)",
);
const decisionEvent = parseAbiItem(
  "event PaymentDecision(bytes32 indexed requestId, bytes32 indexed agentId, uint8 verdict, uint32 riskFlags, uint16 ratingUsed, uint64 decidedAt)",
);

export type Verdict = "ALLOW" | "DENY" | "REVIEW";
const VERDICT: Record<number, Verdict> = { 1: "ALLOW", 2: "DENY", 3: "REVIEW" };

export interface Rating {
  score: number;
  earnings: string;
  paymentCount: number;
  probeOk: boolean;
  latencyMs: number;
  observedAt: number;
  txHash: Hex | null;
}

export interface Decision {
  requestId: Hex;
  verdict: Verdict;
  riskFlags: number;
  ratingUsed: number;
  decidedAt: number;
  txHash: Hex;
}

export async function readRating(): Promise<Rating | null> {
  const [r, ratingLogs] = await Promise.all([
    base.readContract({ address: REGISTRY, abi: registryAbi, functionName: "getRating", args: [ATLAS_ID] }),
    logs((c, fromBlock, toBlock) => c.getLogs({ address: REGISTRY, event: ratingEvent, args: { agentId: ATLAS_ID }, fromBlock, toBlock })),
  ]);
  if (r.observedAt === 0n) return null;
  return {
    score: r.score,
    earnings: r.earnings.toString(),
    paymentCount: r.paymentCount,
    probeOk: r.probeOk,
    latencyMs: r.latencyMs,
    observedAt: Number(r.observedAt),
    txHash: ratingLogs.at(-1)?.transactionHash ?? null,
  };
}

export async function readDecisions(): Promise<Decision[]> {
  const events = await logs((c, fromBlock, toBlock) =>
    c.getLogs({ address: REGISTRY, event: decisionEvent, args: { agentId: ATLAS_ID }, fromBlock, toBlock }),
  );
  return events
    .map((l) => ({
      requestId: l.args.requestId!,
      verdict: VERDICT[l.args.verdict!] ?? "REVIEW",
      riskFlags: l.args.riskFlags!,
      ratingUsed: l.args.ratingUsed!,
      decidedAt: Number(l.args.decidedAt!),
      txHash: l.transactionHash,
    }))
    .sort((a, b) => b.decidedAt - a.decidedAt);
}

// Cardano -------------------------------------------------------------------------

interface BfAmount {
  unit: string;
  quantity: string;
}
interface BfIo {
  address: string;
  amount: BfAmount[];
  output_index?: number;
  tx_hash?: string;
  inline_datum?: string | null;
}

async function blockfrost<T>(path: string): Promise<T | null> {
  const projectId = process.env.BLOCKFROST_PROJECT_ID;
  if (!projectId) throw new Error("BLOCKFROST_PROJECT_ID is not set");
  const res = await fetch(BLOCKFROST_PREPROD_URL + path, { headers: { project_id: projectId }, next: { revalidate: 20 } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Blockfrost ${path} → ${res.status}`);
  return (await res.json()) as T;
}

const tusdmOf = (amounts: BfAmount[], unit: string) =>
  amounts.filter((a) => a.unit === unit).reduce((s, a) => s + BigInt(a.quantity), 0n);

export interface Payment {
  txHash: string;
  index: number;
  time: number;
  unit: "x402" | "masumi";
  amount: string;
  requestId: string | null;
  splitTx: string | null;
}

export interface Split {
  txHash: string;
  time: number;
  coins: number;
  investor: string;
  atlas: string;
}

export interface CardanoActivity {
  payments: Payment[];
  splits: Split[];
  earnedX402: string;
  earnedMasumi: string;
  repaidToInvestor: string;
  lockedNow: string;
}

/** Receipt datum Constr 0 [bytes32 requestId] → requestId. */
function requestIdOf(datum: string | null | undefined): string | null {
  const m = datum?.match(/^d8799f5820([0-9a-f]{64})ff$/);
  return m ? `0x${m[1]}` : null;
}

export async function readCardano(): Promise<CardanoActivity> {
  const history = (await blockfrost<{ tx_hash: string; block_time: number }[]>(`/addresses/${SPLITTER}/transactions?order=desc&count=30`)) ?? [];
  const txs = await Promise.all(
    history.map(async (h) => ({ ...h, utxos: (await blockfrost<{ inputs: BfIo[]; outputs: BfIo[] }>(`/txs/${h.tx_hash}/utxos`))! })),
  );
  const investor = ATLAS_DEAL.investors[0]!.address;

  const payments: Payment[] = [];
  const splits: Split[] = [];
  const spentBy = new Map<string, string>();
  for (const tx of txs) {
    const spent = tx.utxos.inputs.filter((i) => i.address === SPLITTER);
    if (spent.length > 0) {
      for (const i of spent) spentBy.set(`${i.tx_hash}#${i.output_index}`, tx.tx_hash);
      const paid = (address: string) =>
        tx.utxos.outputs.filter((o) => o.address === address).reduce((s, o) => s + tusdmOf(o.amount, TUSDM_X402_UNIT) + tusdmOf(o.amount, TUSDM_MASUMI_UNIT), 0n);
      splits.push({ txHash: tx.tx_hash, time: tx.block_time, coins: spent.length, investor: paid(investor).toString(), atlas: paid(ATLAS_DEAL.atlasAddress).toString() });
    }
    tx.utxos.outputs.forEach((o, index) => {
      if (o.address !== SPLITTER) return;
      const x402 = tusdmOf(o.amount, TUSDM_X402_UNIT);
      const masumi = tusdmOf(o.amount, TUSDM_MASUMI_UNIT);
      if (x402 === 0n && masumi === 0n) return;
      payments.push({
        txHash: tx.tx_hash,
        index: o.output_index ?? index,
        time: tx.block_time,
        unit: masumi > 0n ? "masumi" : "x402",
        amount: (x402 + masumi).toString(),
        requestId: requestIdOf(o.inline_datum),
        splitTx: null,
      });
    });
  }
  for (const p of payments) p.splitTx = spentBy.get(`${p.txHash}#${p.index}`) ?? null;

  const sum = (xs: string[]) => xs.reduce((s, x) => s + BigInt(x), 0n).toString();
  return {
    payments,
    splits,
    earnedX402: sum(payments.filter((p) => p.unit === "x402").map((p) => p.amount)),
    earnedMasumi: sum(payments.filter((p) => p.unit === "masumi").map((p) => p.amount)),
    repaidToInvestor: sum(splits.map((s) => s.investor)),
    lockedNow: sum(payments.filter((p) => !p.splitTx).map((p) => p.amount)),
  };
}
