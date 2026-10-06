import { readFileSync } from "node:fs";
import { repositoryRoot } from "./repository.js";
import { resolve } from "node:path";
import { Address, Data, PlutusV3, ScriptHash, UPLC } from "@evolution-sdk/evolution";
import { TUSDM_ASSET_NAME, TUSDM_MASUMI_POLICY, TUSDM_X402_POLICY, type DealTerms } from "@agentfund/shared";

const BLUEPRINT = resolve(repositoryRoot(), "contracts/cardano/plutus.json");
const MAX_BPS = 10_000;

export const SPLIT_UNITS = [
  { policy: TUSDM_X402_POLICY, name: TUSDM_ASSET_NAME },
  { policy: TUSDM_MASUMI_POLICY, name: TUSDM_ASSET_NAME },
] as const;

export interface SplitterScript {
  /** Parameter-applied script in the blueprint's (single CBOR-wrapped) encoding. */
  code: string;
  hash: string;
  address: string;
  atlasKeyHash: string;
  investors: { keyHash: string; bps: number }[];
}

export function paymentKeyHash(bech32: string): string {
  const credential = Address.fromBech32(bech32).paymentCredential;
  if (credential._tag !== "KeyHash") throw new Error(`${bech32} is not a key address`);
  return Buffer.from(credential.hash).toString("hex");
}

/** Strips one CBOR byte-string header, as @x402/cardano does before hashing. */
export function unwrapCborBytes(hex: string): string {
  const b = Buffer.from(hex, "hex");
  if (b.length === 0 || b[0]! >> 5 !== 2) throw new Error("expected a CBOR byte string");
  const info = b[0]! & 31;
  const [length, offset] =
    info < 24 ? [info, 1] : info === 24 ? [b[1]!, 2] : info === 25 ? [b.readUInt16BE(1), 3] : [b.readUInt32BE(1), 5];
  return b.subarray(offset, offset + length).toString("hex");
}

export function scriptHashOf(code: string): string {
  const script = new PlutusV3.PlutusV3({ bytes: Buffer.from(code, "hex") });
  return ScriptHash.toHex(ScriptHash.fromScript(script)).toLowerCase();
}

export function validateDeal(deal: DealTerms): void {
  const total = deal.investors.reduce((sum, i) => sum + i.bps, 0);
  if (deal.investors.some((i) => !Number.isInteger(i.bps) || i.bps <= 0)) throw new Error("every investor share must be a positive integer of basis points");
  // The validator rejects shares over 100%, which would lock funds permanently; refuse before deploying.
  if (total > MAX_BPS) throw new Error(`investor shares add up to ${total} bps, over ${MAX_BPS}`);
}

export function buildSplitter(deal: DealTerms, blueprintPath = BLUEPRINT): SplitterScript {
  validateDeal(deal);
  const blueprint = JSON.parse(readFileSync(blueprintPath, "utf8")) as { validators: { title: string; compiledCode: string }[] };
  const validator = blueprint.validators.find((v) => v.title === "splitter.splitter.spend");
  if (!validator) throw new Error("splitter.spend not found in blueprint");

  const atlasKeyHash = paymentKeyHash(deal.atlasAddress);
  const investors = deal.investors.map((i) => ({ keyHash: paymentKeyHash(i.address), bps: i.bps }));

  const applied = UPLC.applyParamsToScript(validator.compiledCode, [
    Data.bytearray(atlasKeyHash),
    Data.list(investors.map((i) => Data.constr(0n, [Data.bytearray(i.keyHash), Data.int(BigInt(i.bps))]))),
    Data.list(SPLIT_UNITS.map((u) => Data.constr(0n, [Data.bytearray(u.policy), Data.bytearray(u.name)]))),
  ]);
  const code = unwrapCborBytes(applied);
  const hash = scriptHashOf(code);
  const address = Address.toBech32(new Address.Address({ networkId: 0, paymentCredential: ScriptHash.fromHex(hash) }));
  return { code, hash, address, atlasKeyHash, investors };
}
