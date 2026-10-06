export interface PendingRoundAction { action: string; at: string; txHash?: string }
/** Absence in an address listing is not proof of non-submission. Resolve only the exact saved hash. */
export async function resolvePending(pending: PendingRoundAction, confirmed: (hash: string) => Promise<boolean>): Promise<string> {
  if (!pending.txHash || !/^[0-9a-f]{64}$/.test(pending.txHash)) throw new Error("Legacy pending action has no transaction hash. It requires manual transaction inspection; no retry was enabled.");
  if (!await confirmed(pending.txHash)) throw new Error("Exact transaction is not confirmed. Pending state retained; do not submit a replacement.");
  return pending.txHash;
}
