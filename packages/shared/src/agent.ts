import type { ChainClient } from "./chain.js";
import { ATLAS_MASUMI_PAYOUT_ADDRESS } from "./deal.js";

/** Masumi's Web3CardanoV2 registry policy on preprod. An NFT under it is an agent registration. */
export const MASUMI_REGISTRY_POLICY = "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b";

/** Agents AgentFund has funded, so their Chainlink rating can be shown next to their identity. */
const FUNDED: Record<string, string> = { [ATLAS_MASUMI_PAYOUT_ADDRESS]: "atlas" };

export interface RegisteredAgent {
  /** The registry NFT's asset unit; the agent's on-chain identifier. */
  unit: string;
  name: string;
  description: string;
  author: string | null;
  apiBaseUrl: string | null;
  capability: string | null;
  /** Set when AgentFund funds this agent, so a rating can be looked up. */
  fundedAgentId: string | null;
}

interface BfAddress {
  amount: { unit: string; quantity: string }[];
}
interface BfAsset {
  onchain_metadata: Record<string, unknown> | null;
}

/** Cardano metadata splits long strings into 64-byte chunks, so values arrive as arrays. */
function text(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string").join("") || null;
  return null;
}

function nested(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const record = Array.isArray(value) ? value[0] : value;
  if (!record || typeof record !== "object") return null;
  return text((record as Record<string, unknown>)[key]);
}

/**
 * Identifies whether an address belongs to an AI agent registered on Masumi, by looking for the
 * registry NFT it holds and reading that token's on-chain metadata. A block explorer shows the
 * token; it does not tell you the address is a paid agent, or what it claims to do.
 */
export async function detectRegisteredAgent(address: string, chain: ChainClient): Promise<RegisteredAgent | null> {
  const info = await chain.blockfrost<BfAddress>(`/addresses/${address}`);
  const held = info?.amount.find((a) => a.unit.startsWith(MASUMI_REGISTRY_POLICY) && a.quantity === "1");
  if (!held) return null;

  const asset = await chain.blockfrost<BfAsset>(`/assets/${held.unit}`);
  const md = asset?.onchain_metadata;
  if (!md) return null;

  const name = text(md.name) ?? "Unnamed agent";
  return {
    unit: held.unit,
    name,
    description: text(md.description) ?? "",
    author: nested(md.author, "name"),
    apiBaseUrl: text(md.api_base_url) ?? text(md.apiBaseUrl),
    capability: nested(md.capability, "name"),
    fundedAgentId: FUNDED[address] ?? null,
  };
}

export interface CounterpartyRisk {
  address: string;
  transactions: number;
  /** Shared transactions with the subject. */
  seen: number;
  isScript: boolean;
  /** Almost no history of its own. */
  thin: boolean;
}

interface BfTotal {
  tx_count: number;
}
interface BfScript {
  script: boolean;
}

/** Scores the addresses this wallet actually deals with, one hop out. */
export async function assessCounterparties(
  counterparties: { address: string; transactions: number }[],
  chain: ChainClient,
): Promise<CounterpartyRisk[]> {
  return Promise.all(
    counterparties.map(async (c) => {
      const [info, total] = await Promise.all([
        chain.blockfrost<BfScript>(`/addresses/${c.address}`),
        chain.blockfrost<BfTotal>(`/addresses/${c.address}/total`),
      ]);
      const transactions = total?.tx_count ?? 0;
      return {
        address: c.address,
        transactions,
        seen: c.transactions,
        isScript: info?.script ?? false,
        thin: transactions > 0 && transactions < 3,
      };
    }),
  );
}
