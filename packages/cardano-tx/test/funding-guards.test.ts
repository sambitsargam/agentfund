import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Address, KeyHash, PrivateKey, TransactionWitnessSet, VKey } from "@evolution-sdk/evolution";
import { checkProposalReservation, fundingQuota, verifyFundingWitnesses, withProposalLock } from "../src/funding-guards.js";
const dir = () => mkdtempSync(join(tmpdir(), "funding-guards-"));
const key = PrivateKey.fromHex("11".repeat(32)), wrongKey = PrivateKey.fromHex("22".repeat(32));
const address = Address.toBech32(Address.fromHex("60" + KeyHash.toHex(KeyHash.fromVKey(VKey.fromPrivateKey(key)))));
const hash = "ab".repeat(32);
const witness = (k = key, h = hash) => new TransactionWitnessSet.VKeyWitness({ vkey: VKey.fromPrivateKey(k), signature: PrivateKey.sign(k, Buffer.from(h, "hex")) });
const encoded = (...w: TransactionWitnessSet.VKeyWitness[]) => TransactionWitnessSet.toCBORHex(TransactionWitnessSet.fromVKeyWitnesses(w));
describe("funding signatures", () => {
  it("accepts the expected payment key signing the exact body hash", () => expect(() => verifyFundingWitnesses({ address, txHash: hash }, encoded(witness()))).not.toThrow());
  it("rejects a valid signature from a different wallet", () => expect(() => verifyFundingWitnesses({ address, txHash: hash }, encoded(witness(wrongKey)))).toThrow("expected payment key"));
  it("rejects the expected key signing another transaction", () => expect(() => verifyFundingWitnesses({ address, txHash: hash }, encoded(witness(key, "cd".repeat(32))))).toThrow("Invalid wallet signature"));
  it("rejects empty, malformed and mixed invalid witnesses", () => {
    for (const hex of ["a0", "00", "xyz", encoded(witness(), witness(wrongKey, "cd".repeat(32)))]) expect(() => verifyFundingWitnesses({ address, txHash: hash }, hex)).toThrow("Invalid wallet signature");
  });
});
describe("funding provider quotas", () => {
  it("bounds build requests persistently while allowing confirmation and resetting only at the next minute", () => {
    const d = dir(); for (let n = 0; n < 6; n++) fundingQuota(d, "build", 60001);
    expect(() => fundingQuota(d, "build", 60002)).toThrow("limit reached");
    expect(() => fundingQuota(d, "confirm", 60002)).not.toThrow();
    expect(() => fundingQuota(d, "build", 120001)).not.toThrow();
  });
});
describe("funding proposal reservations", () => {
  it("keeps wallet and round reserved beyond signing expiry until chain expiry, across store instances", () => {
    const d = dir(); mkdirSync(join(d, "tickets"));
    writeFileSync(join(d, "tickets", "ticket.json"), JSON.stringify({ address, roundId: "round", expiresAt: 100000 }));
    expect(() => checkProposalReservation(d, address, "different-round", 110000)).toThrow("existing proposal");
    expect(() => checkProposalReservation(d, "another-wallet", "round", 110000)).toThrow("existing proposal");
    expect(() => checkProposalReservation(d, "another-wallet", "different-round", 110000)).not.toThrow();
    expect(() => checkProposalReservation(d, address, "round", 220001)).not.toThrow();
    writeFileSync(join(d, "tickets", "ticket.json"), JSON.stringify({ address, roundId: "round", expiresAt: 100000, confirmedAt: 90000 }));
    expect(() => checkProposalReservation(d, address, "round", 110000)).not.toThrow();
  });
  it("blocks a second builder until ticket persistence is finished and releases on errors", async () => {
    const d = dir(); let release!: () => void;
    const pending = withProposalLock(d, () => new Promise<void>(r => { release = r; }));
    await expect(withProposalLock(d, async () => 2)).rejects.toThrow("Another transaction");
    release(); await pending;
    await expect(withProposalLock(d, async () => { throw new Error("provider outage"); })).rejects.toThrow("provider outage");
    await expect(withProposalLock(d, async () => 3)).resolves.toBe(3);
  });
});
