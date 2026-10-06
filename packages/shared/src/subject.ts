import { ADA_HANDLE_POLICY, CIP68_USER_TOKEN_LABEL } from "./assets.js";
import type { ChainClient } from "./chain.js";

export type SubjectKind = "payment-address" | "stake-address" | "handle";

export interface Subject {
  input: string;
  kind: SubjectKind;
  /** The payment address used for address-level queries. */
  address: string;
  stakeAddress: string | null;
  handle: string | null;
}

export class InvalidInputError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = "InvalidInputError";
  }
}

const BECH32_BODY = "[02-9ac-hj-np-z]";
const PREPROD_ADDRESS = new RegExp(`^addr_test1${BECH32_BODY}{50,110}$`);
const PREPROD_STAKE = new RegExp(`^stake_test1${BECH32_BODY}{50,60}$`);
const MAINNET_PREFIX = /^(addr1|stake1)/;
const HANDLE = /^\$[a-z0-9_.-]{1,15}$/;

const INPUT_HINT =
  "Send one Cardano preprod payment address (addr_test1…), stake address (stake_test1…) or ADA Handle ($name).";

/** Pulls the first address-like token out of free text, so a Task can say "check addr_test1…". */
export function extractCandidate(text: string): string | null {
  const match = text.match(/(addr_test1\w+|stake_test1\w+|addr1\w+|stake1\w+|\$[A-Za-z0-9_.-]+)/);
  return match ? match[1]!.trim() : null;
}

export function classify(raw: string): { kind: SubjectKind; value: string } {
  const value = raw.trim();
  if (MAINNET_PREFIX.test(value)) {
    throw new InvalidInputError("That is a mainnet address.", `Atlas checks Cardano preprod only. ${INPUT_HINT}`);
  }
  if (PREPROD_ADDRESS.test(value)) return { kind: "payment-address", value };
  if (PREPROD_STAKE.test(value)) return { kind: "stake-address", value };
  if (HANDLE.test(value.toLowerCase())) return { kind: "handle", value: value.toLowerCase() };
  throw new InvalidInputError("Atlas could not read that as a Cardano address or handle.", INPUT_HINT);
}

interface BlockfrostAddress {
  address: string;
  stake_address: string | null;
}
interface BlockfrostAssetHolder {
  address: string;
  quantity: string;
}
interface BlockfrostAccountAddress {
  address: string;
}

export async function resolveSubject(raw: string, chain: ChainClient): Promise<Subject> {
  const { kind, value } = classify(raw);

  if (kind === "payment-address") {
    const info = await chain.blockfrost<BlockfrostAddress>(`/addresses/${value}`);
    return { input: raw, kind, address: value, stakeAddress: info?.stake_address ?? null, handle: null };
  }

  if (kind === "stake-address") {
    const addresses = await chain.blockfrost<BlockfrostAccountAddress[]>(`/accounts/${value}/addresses?count=1`);
    const first = addresses?.[0]?.address;
    if (!first) {
      throw new InvalidInputError("That stake address has no payment addresses on preprod.", INPUT_HINT);
    }
    return { input: raw, kind, address: first, stakeAddress: value, handle: null };
  }

  const name = value.slice(1);
  const nameHex = Buffer.from(name, "utf8").toString("hex");
  for (const assetName of [CIP68_USER_TOKEN_LABEL + nameHex, nameHex]) {
    const holders = await chain.blockfrost<BlockfrostAssetHolder[]>(`/assets/${ADA_HANDLE_POLICY}${assetName}/addresses`);
    const holder = holders?.find((h) => h.quantity === "1");
    if (holder) {
      const info = await chain.blockfrost<BlockfrostAddress>(`/addresses/${holder.address}`);
      return { input: raw, kind, address: holder.address, stakeAddress: info?.stake_address ?? null, handle: value };
    }
  }
  throw new InvalidInputError(`No ADA Handle ${value} exists on preprod.`, INPUT_HINT);
}
