import "server-only";
import { allPages, summarizeCardano, type BfIo, type CardanoActivity, type CardanoTransaction } from "./cardano-activity";
export type { Payment, Split, CardanoActivity } from "./cardano-activity";
import { createPublicClient, http, keccak256, parseAbi, parseAbiItem, stringToBytes, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { ATLAS_DEAL, ATLAS_MASUMI_PAYOUT_ADDRESS, BLOCKFROST_PREPROD_URL } from "@agentfund/shared";
import { traceTaskRepayment, type TaskRepayment } from "./task-repayment";
import type { CoworkerTask } from "./sokosumi";

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

async function blockfrost<T>(path: string): Promise<T | null> {
  const projectId = process.env.BLOCKFROST_PROJECT_ID;
  if (!projectId) throw new Error("BLOCKFROST_PROJECT_ID is not set");
  const res = await fetch(BLOCKFROST_PREPROD_URL + path, { headers: { project_id: projectId }, next: { revalidate: 20 }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Blockfrost ${path} → ${res.status}`);
  return (await res.json()) as T;
}

export async function readCardano(): Promise<CardanoActivity> {
  const [history, locked] = await Promise.all([
    allPages(async (page) => (await blockfrost<{ tx_hash: string; block_time: number }[]>(
      `/addresses/${SPLITTER}/transactions?order=asc&count=100&page=${page}`,
    )) ?? []),
    allPages(async (page) => (await blockfrost<BfIo[]>(`/addresses/${SPLITTER}/utxos?count=100&page=${page}`)) ?? []),
  ]);
  const txs: CardanoTransaction[] = [];
  // Bound the provider fanout instead of issuing the entire history at once.
  for (let offset = 0; offset < history.length; offset += 10) {
    txs.push(...await Promise.all(history.slice(offset, offset + 10).map(async (h) => {
      const utxos = await blockfrost<{ inputs: BfIo[]; outputs: BfIo[] }>(`/txs/${h.tx_hash}/utxos`);
      if (!utxos) throw new Error(`Transaction ${h.tx_hash} is not available yet`);
      return { ...h, utxos };
    })));
  }
  return summarizeCardano(txs, locked, SPLITTER);
}

export async function readTaskRepayments(tasks: CoworkerTask[] | null, activity: CardanoActivity | null): Promise<Record<string, TaskRepayment>> {
  const result: Record<string, TaskRepayment> = {};
  const collected = (tasks ?? []).filter(t => t.paid && t.collectionTx);
  for (let offset = 0; offset < collected.length; offset += 10) {
    await Promise.all(collected.slice(offset, offset + 10).map(async t => {
      try {
        if (!activity) throw new Error("chain unavailable");
        const receipt = await blockfrost<{ inputs: BfIo[]; outputs: BfIo[] }>(`/txs/${t.collectionTx}/utxos`);
        if (!receipt) throw new Error("receipt unavailable");
        result[t.taskId] = traceTaskRepayment(t.collectionTx!, receipt, activity.transactions,
          t.collectionAddress || process.env.MASUMI_PAYOUT_ADDRESS || ATLAS_MASUMI_PAYOUT_ADDRESS,
          SPLITTER, t.collectedAtomicUnits);
      } catch {
        result[t.taskId] = { status: "unverified", collected: null, paths: [], note: "Could not verify the collection-to-investor path from the chain. The worker's receipt alone does not prove repayment." };
      }
    }));
  }
  return result;
}
