import "server-only";

export interface CoworkerTask {
  taskId: string;
  stage: string;
  marketplaceStatus?: string | null;
  sourceStale?: boolean;
  paid: boolean;
  delivered: boolean | null;
  startedAt: string;
  updatedAt: string | null;
  purchaseEventId: string | null;
  completionEventId: string | null;
  blockchainIdentifier: string | null;
  unlockTime: string | null;
  onChainState: string | null;
  resultHash: string | null;
  collectionTx: string | null;
  collectedAtomicUnits: string | null;
  collectionAddress?: string | null;
  error: string | null;
}

/** Progress feed published by the Coworker worker; null when the worker is not reachable. */
export async function readCoworkerTasks(): Promise<CoworkerTask[] | null> {
  const url = process.env.COWORKER_URL;
  if (!url) return null;
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/tasks`, {
      next: { revalidate: 20 },
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok ? ((await res.json()) as CoworkerTask[]) : null;
  } catch {
    return null;
  }
}

export interface AgentIdentity {
  coworkerId: string | null;
  masumi: {
    state: string | null;
    agentIdentifier: string | null;
    x402ResourcesUrl: string | null;
  } | null;
  paidTasks: boolean;
}

/** Where Atlas is registered; null when the worker is not reachable. */
export async function readAgentIdentity(): Promise<AgentIdentity | null> {
  const url = process.env.COWORKER_URL;
  if (!url) return null;
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/agent`, {
      next: { revalidate: 20 },
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok ? ((await res.json()) as AgentIdentity) : null;
  } catch {
    return null;
  }
}

export interface ReliabilitySnapshot {
  observedAt: string;
  paidTasksSeen: number;
  paidCollectionsVerified: number;
  paidTasksFailed: number;
  paidTasksOngoing: number;
  paidTasksNeedingRecovery?: number;
  /** Timestamps, so the page can say whether failures stopped rather than only how many. */
  lastFailureAt?: string | null;
  lastCollectionAt?: string | null;
  scope: string;
}
export async function readReliability(): Promise<ReliabilitySnapshot | null> {
  if (!process.env.COWORKER_URL) return null;
  try {
    const r = await fetch(
      `${process.env.COWORKER_URL.replace(/\/$/, "")}/reliability`,
      { next: { revalidate: 20 }, signal: AbortSignal.timeout(8_000) },
    );
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
