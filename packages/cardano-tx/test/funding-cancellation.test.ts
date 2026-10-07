import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Address, KeyHash, PrivateKey, Transaction, TransactionBody, TransactionHash, TransactionWitnessSet, VKey } from "@evolution-sdk/evolution";
import { assembleFunding, discardFunding } from "../src/funding-service.js";
import { checkProposalReservation } from "../src/funding-guards.js";
import { RoundStore } from "../src/round-store.js";
import type { FundingTicket } from "../src/funding-types.js";
const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function fixture(state: FundingTicket["proposalState"] = "unsigned") {
  const dir = mkdtempSync(join(tmpdir(), "funding-cancel-")); dirs.push(dir); vi.stubEnv("FUNDING_DATA_DIR", dir);
  const key = PrivateKey.fromHex("11".repeat(32));
  const address = Address.toBech32(Address.fromHex("60" + KeyHash.toHex(KeyHash.fromVKey(VKey.fromPrivateKey(key)))));
  const cbor = "84a3008001800200a0f5f6";
  const txHash = TransactionHash.toHex(TransactionBody.toHash(Transaction.fromCBORHex(cbor).body));
  const ticket: FundingTicket = { id: "test", roundId: "round", action: "fund", address, terms: { capital: "250000", bps: 4000, cap: "400000", operator: "operator" }, cbor, txHash, expiresAt: Date.now() + 540000, fee: "0", proposalState: state };
  const db = new RoundStore(dir); db.write("tickets", ticket.id, ticket);
  const witnesses = TransactionWitnessSet.toCBORHex(TransactionWitnessSet.fromVKeyWitnesses([new TransactionWitnessSet.VKeyWitness({ vkey: VKey.fromPrivateKey(key), signature: PrivateKey.sign(key, Buffer.from(txHash, "hex")) })]));
  return { dir, db, ticket, witnesses };
}
describe("unsigned proposal lifecycle", () => {
  it("reopens the identical proposal but keeps other actions and wallets reserved", () => {
    const { dir, ticket } = fixture();
    expect(checkProposalReservation(dir, ticket.address, "round", Date.now(), { action: "fund" })).toEqual(ticket);
    expect(() => checkProposalReservation(dir, ticket.address, "round", Date.now(), { action: "distribute" })).toThrow("existing proposal");
    expect(() => checkProposalReservation(dir, "other", "round", Date.now(), { action: "fund" })).toThrow("existing proposal");
    expect(() => checkProposalReservation(dir, ticket.address, "other", Date.now(), { action: "fund" })).toThrow("existing proposal");
  });
  it("cancels an unsigned review idempotently, releases its reservation and rejects later signing", async () => {
    const { dir, ticket, witnesses } = fixture();
    await expect(discardFunding(ticket.id)).resolves.toEqual({ discarded: true });
    await expect(discardFunding(ticket.id)).resolves.toEqual({ discarded: true });
    expect(checkProposalReservation(dir, ticket.address, "round")).toBeUndefined();
    await expect(assembleFunding(ticket.id, witnesses)).rejects.toThrow("discarded");
  });
  it("persists assembly before returning signed bytes and refuses cancellation afterward", async () => {
    const { db, ticket, witnesses } = fixture();
    await expect(assembleFunding(ticket.id, witnesses)).resolves.toMatchObject({ txHash: ticket.txHash });
    expect(db.read<FundingTicket>("tickets", ticket.id)?.proposalState).toBe("assembled");
    await expect(discardFunding(ticket.id)).rejects.toThrow("may already be signed");
  });
  it("invalid signatures leave an unsigned proposal cancellable", async () => {
    const { ticket } = fixture();
    await expect(assembleFunding(ticket.id, "a0")).rejects.toThrow("Invalid wallet signature");
    await expect(discardFunding(ticket.id)).resolves.toEqual({ discarded: true });
  });
  it("keeps legacy proposals reserved until chain expiry", async () => {
    const { db, ticket } = fixture(); delete ticket.proposalState; db.write("tickets", ticket.id, ticket);
    await expect(discardFunding(ticket.id)).rejects.toThrow("may already be signed");
    db.write("tickets", ticket.id, { ...ticket, expiresAt: Date.now() - 120001 });
    await expect(discardFunding(ticket.id)).resolves.toEqual({ discarded: true });
  });
  it("serializes cancellation against assembly", async () => {
    const { ticket, witnesses } = fixture();
    const signing = assembleFunding(ticket.id, witnesses);
    await expect(discardFunding(ticket.id)).rejects.toThrow("Another transaction");
    await signing;
    await expect(discardFunding(ticket.id)).rejects.toThrow("may already be signed");
  });
});
