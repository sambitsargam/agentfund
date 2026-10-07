import { fundingQuota, withProposalLock, checkProposalReservation, verifyFundingWitnesses } from "./funding-guards.js";
import { randomUUID } from "node:crypto";
import { Address, Assets, Client, Transaction, TransactionBody, TransactionHash, preprod } from "@evolution-sdk/evolution";
import { ATLAS_DEAL, BLOCKFROST_PREPROD_URL, TUSDM_X402_POLICY, TUSDM_ASSET_NAME } from "@agentfund/shared";
import { RoundStore, buildRound, readRound, prepareRoundOpen, prepareRoundFund, prepareRoundDistribute, prepareRoundCancel, validateRoundTerms, type RoundConfig } from "./index.js";
import type { FundingAction, FundingTicket, FundingView } from "./funding-types.js";

export const store = () => new RoundStore();
export function walletAddress(raw: string): string {
  const a = raw.startsWith("addr") ? Address.fromBech32(raw) : Address.fromHex(raw);
  if (a.networkId !== 0 || a.paymentCredential._tag !== "KeyHash") throw new Error("Connect a preprod payment wallet");
  return Address.toBech32(a);
}
export function provider(address = ATLAS_DEAL.atlasAddress) {
  const projectId = process.env.BLOCKFROST_PROJECT_ID;
  if (!projectId) throw new Error("Funding provider is not configured");
  return Client.make(preprod).withBlockfrost({ baseUrl: BLOCKFROST_PREPROD_URL, projectId }).withAddress(address);
}
export async function fundingViews(): Promise<FundingView[]> {
  return Promise.all(store().rounds().map(async c => {
    const base = { id: c.id, address: buildRound(c).address, serviceUrl: `${(process.env.ATLAS_PUBLIC_URL ?? "http://localhost:4021").replace(/\/$/, "")}/rounds/${c.id}/report`, ...c.terms, earned: "0", paid: "0", waiting: "0" };
    try {
      const r = await readRound(provider(), c);
      return { ...base, ...(r.state && "investor" in r.state ? r.state : {}), stage: r.state?.stage ?? "opening", waiting: r.receipts.reduce((n, u) => n + Assets.getByUnit(u.assets, c.terms.policy + c.terms.name), 0n).toString() };
    } catch { return { ...base, stage: "unavailable" as const, error: "Cannot read the chain. Funding is paused until it can be verified." }; }
  }));
}
async function prepareFundingUnlocked(input: { action: FundingAction; address: string; roundId?: string; capital?: string; bps?: number; cap?: string }): Promise<FundingTicket> {
  const address = walletAddress(input.address), client = provider(address), db = store();
  const existing = checkProposalReservation(db.dir, address, input.roundId, Date.now(), input);
  if (existing) return existing;
  let c: RoundConfig;
  let built;
  if (input.action === "open") {
    if (address !== ATLAS_DEAL.atlasAddress) throw new Error("Only Atlas's configured operator can offer its earnings");
    const terms = { operator: address, policy: TUSDM_X402_POLICY, name: TUSDM_ASSET_NAME, capital: input.capital ?? "", bps: input.bps ?? 0, cap: input.cap ?? "" };
    validateRoundTerms(terms);
    if (BigInt(terms.capital) > 100_000_000n || BigInt(terms.cap) > 200_000_000n) throw new Error("Test round limit: 100 tUSDM capital and 200 tUSDM repayment cap");
    const coins = await client.getUtxos(Address.fromBech32(address));
    const seedCoin = coins.filter(u => Assets.getByUnit(u.assets, "lovelace") >= 6_000_000n)
      .sort((a, b) => Assets.getByUnit(a.assets, "lovelace") > Assets.getByUnit(b.assets, "lovelace") ? -1 : 1)[0];
    if (!seedCoin) throw new Error("Operator needs an unspent coin with at least 6 test ADA, plus separate collateral");
    c = { id: "draft", agent: "atlas", service: "recipient-check", terms, seed: { txHash: TransactionHash.toHex(seedCoin.transactionId), index: Number(seedCoin.index) } };
    c.id = buildRound(c).hash;
    built = await prepareRoundOpen(client, c);
  } else {
    c = db.round(input.roundId ?? "");
    if (input.action === "fund") built = await prepareRoundFund(client, c, address);
    else if (input.action === "cancel") {
      if (address !== c.terms.operator) throw new Error("Only the operator can cancel an unfunded round");
      built = await prepareRoundCancel(client, c);
    } else if (input.action === "distribute") built = (await prepareRoundDistribute(client, c)).built;
    else throw new Error("Unknown funding action");
  }
  const tx = await built.toTransaction();
  const ticket: FundingTicket = { proposalState: "unsigned", id: randomUUID(), roundId: c.id, action: input.action, address, terms: c.terms, cbor: Transaction.toCBORHex(tx), txHash: TransactionHash.toHex(TransactionBody.toHash(tx.body)), expiresAt: Date.now() + 540_000, fee: String(await built.estimateFee()) };
  db.write("tickets", ticket.id, ticket);
  if (input.action === "open") db.write("rounds", c.id, c);
  return ticket;
}
export async function prepareFunding(input: Parameters<typeof prepareFundingUnlocked>[0]): Promise<FundingTicket> {
  return withProposalLock(store().dir, () => prepareFundingUnlocked(input));
}
export async function assembleFunding(id: string, witnesses: string) {
  const db = store();
  return withProposalLock(db.dir, async () => {
    const ticket = db.read<FundingTicket>("tickets", id);
    if (!ticket) throw new Error("Transaction proposal not found");
    if (ticket.proposalState === "discarded") throw new Error("Transaction proposal was discarded. Prepare a new one before signing.");
    if (Date.now() > ticket.expiresAt) throw new Error("The unsigned proposal expired. Build a fresh proposal before signing.");
    verifyFundingWitnesses(ticket, witnesses);
    const signedCbor = Transaction.addVKeyWitnessesHex(ticket.cbor, witnesses);
    // Persist before returning signed bytes: losing the response must not make cancellation safe.
    db.write("tickets", id, { ...ticket, proposalState: "assembled" });
    return { signedCbor, txHash: ticket.txHash };
  });
}
export async function discardFunding(id: string) {
  const db = store();
  return withProposalLock(db.dir, async () => {
    const ticket = db.read<FundingTicket>("tickets", id);
    if (!ticket) throw new Error("Transaction proposal not found");
    if (ticket.proposalState === "discarded") return { discarded: true };
    if (ticket.proposalState !== "unsigned" && Date.now() < ticket.expiresAt + 120000) throw new Error("Transaction proposal may already be signed. Check confirmation or wait for chain expiry; it cannot be safely cancelled yet.");
    db.write("tickets", id, { ...ticket, proposalState: "discarded" });
    return { discarded: true };
  });
}
export async function fundingConfirmation(id: string) {
  const ticket = store().read<FundingTicket>("tickets", id);
  if (!ticket) throw new Error("Transaction proposal not found");
  const r = await fetch(`${BLOCKFROST_PREPROD_URL}/txs/${ticket.txHash}`, { headers: { project_id: process.env.BLOCKFROST_PROJECT_ID! }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (r.status === 404) return { confirmed: false, txHash: ticket.txHash, message: "Not confirmed yet. Keep this transaction; do not create a replacement payment." };
  if (!r.ok) throw new Error("Confirmation provider unavailable; transaction status remains unknown");
  const confirmed = Number((await r.json()).block_height) > 0;
  if (confirmed) await withProposalLock(store().dir, async () => {
    const db = store(), current = db.read<FundingTicket>("tickets", ticket.id);
    if (current) db.write("tickets", ticket.id, { ...current, confirmedAt: Date.now() });
  });
  return { confirmed, txHash: ticket.txHash };
}

/** Shared handler for a persistent Atlas host and the local dashboard. No signing keys used. */
export async function fundingAction(body: Record<string, any>) {
  const group = ["open", "fund", "distribute", "cancel"].includes(body.action) ? "build" : body.action === "confirm" ? "confirm" : "other";
  fundingQuota(store().dir, group);
  if (body.action === "connect") return { address: walletAddress(body.address) };
  if (body.action === "discard") return discardFunding(body.id);
  if (body.action === "assemble") return assembleFunding(body.id, body.witnesses);
  if (body.action === "confirm") return fundingConfirmation(body.id);
  if (!["open", "fund", "distribute", "cancel"].includes(body.action)) throw new Error("Unknown funding action");
  return prepareFunding(body as Parameters<typeof prepareFunding>[0]);
}
export function publicFundingError(err: unknown) {
  const message = err instanceof Error ? err.message : "";
  const safe = /^(Connect |Only |Invalid |Test round |Operator needs |Round |No confirmed |Investor and |Unknown |Transaction proposal |The unsigned |Request is |Confirmation provider)/.test(message);
  return safe ? message.split("\n")[0]! : "Could not prepare the transaction. Check test ADA, tUSDM and collateral, then retry.";
}
