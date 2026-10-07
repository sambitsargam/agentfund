import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { Address, KeyHash, TransactionWitnessSet, VKey } from "@evolution-sdk/evolution";
import type { FundingTicket } from "./funding-types.js";

export class FundingLimited extends Error {
  constructor(message: string, readonly retryAfter: number) { super(message); }
}
/** Durable global quotas bound provider usage even when callers rotate addresses or the host restarts. */
export function fundingQuota(dir: string, group: "read" | "build" | "confirm" | "other", now = Date.now()) {
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, ".quota-lock");
  try { mkdirSync(lock); } catch { throw new FundingLimited("Funding requests are busy. Try again shortly.", 2); }
  try {
    const file = join(dir, "quota.json");
    const data = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    const window = Math.floor(now / 60000), limit = { read: 120, build: 6, confirm: 30, other: 120 }[group];
    const entry = data[group]?.window === window ? data[group] : { window, count: 0 };
    if (entry.count >= limit) throw new FundingLimited("Funding request limit reached. Try again shortly.", Math.ceil((60000 - now % 60000) / 1000));
    data[group] = { window, count: entry.count + 1 };
    writeFileSync(file + ".tmp", JSON.stringify(data), { mode: 0o600 }); renameSync(file + ".tmp", file);
  } finally { rmdirSync(lock); }
}
/** Held across preparation and ticket persistence. A crash fails closed for operator inspection. */
export async function withProposalLock<T>(dir: string, action: () => Promise<T>): Promise<T> {
  mkdirSync(dir, { recursive: true }); const lock = join(dir, ".proposal-lock");
  try { mkdirSync(lock); } catch { throw new FundingLimited("Another transaction is being prepared. If this persists, the operator must inspect the proposal lock.", 5); }
  try { return await action(); } finally { rmdirSync(lock); }
}
/** Reserve this wallet and round through chain expiry, not merely through the shorter signing deadline. */
export function checkProposalReservation(dir: string, address: string, roundId?: string, now = Date.now()) {
  const path = join(dir, "tickets"); if (!existsSync(path)) return;
  for (const file of readdirSync(path).filter(f => f.endsWith(".json"))) {
    const t = JSON.parse(readFileSync(join(path, file), "utf8")) as FundingTicket & { confirmedAt?: number };
    // Builders use a 10-minute chain TTL. Reserve for 11 minutes after preparation,
    // including legacy tickets: 9-minute signing expiry + 2-minute safety margin.
    const until = t.expiresAt + 120000;
    if (!t.confirmedAt && until > now && (t.address === address || (roundId && t.roundId === roundId))) {
      throw new FundingLimited("An existing proposal reserves this wallet or round. Finish it, check confirmation, or wait for its chain expiry before preparing another.", Math.ceil((until - now) / 1000));
    }
  }
}
/** Verify every supplied signature over the immutable body hash and require the expected payment key. */
export function verifyFundingWitnesses(ticket: Pick<FundingTicket, "address" | "txHash">, hex: string) {
  try {
    if (typeof hex !== "string" || !/^(?:[0-9a-fA-F]{2}){1,32000}$/.test(hex)) throw new Error();
    const credential = Address.fromBech32(ticket.address).paymentCredential;
    if (credential._tag !== "KeyHash") throw new Error();
    const witnesses = TransactionWitnessSet.fromCBORHex(hex).vkeyWitnesses ?? [];
    const hash = Buffer.from(ticket.txHash, "hex");
    if (!witnesses.length || !witnesses.every(w => VKey.verify(w.vkey, hash, w.signature.bytes))) throw new Error();
    if (!witnesses.some(w => KeyHash.toHex(KeyHash.fromVKey(w.vkey)) === KeyHash.toHex(credential))) throw new Error();
  } catch { throw new Error("Invalid wallet signature: the proposal must be signed by its expected payment key"); }
}
