import { TUSDM_UNITS, formatAda, formatTusdm } from "./assets.js";
import { assessCounterparties, detectRegisteredAgent, type CounterpartyRisk, type RegisteredAgent } from "./agent.js";
import { ChainClient, type SourceRecord } from "./chain.js";
import { SCORING_RULES, scoreFacts, type Facts, type Score } from "./score.js";
import { resolveSubject, type Subject } from "./subject.js";

export const REPORT_VERSION = "1";

/** Recent transactions inspected for counterparties; keeps one report under ~20 HTTP calls. */
const COUNTERPARTY_SAMPLE = 8;
const RECENT_WINDOW = 100;

export interface Counterparty {
  address: string;
  transactions: number;
}

export interface Report {
  version: string;
  generatedAt: string;
  subject: Subject;
  /** Set when the address belongs to an AI agent registered on Masumi. */
  agent: RegisteredAgent | null;
  counterpartyRisk: CounterpartyRisk[];
  facts: {
    found: boolean;
    isScript: boolean;
    balanceAda: string;
    tusdmBalance: string;
    tokenKinds: number;
    txCount: number;
    firstSeen: string | null;
    lastSeen: string | null;
    ageDays: number | null;
    txsLast24h: number;
    txsLast30d: number;
    /** True when the 30-day count hit the sampling window, so the real number is higher. */
    txsLast30dCapped: boolean;
    delegatedPool: string | null;
    topCounterparties: Counterparty[];
  };
  score: Score;
  crossCheck: {
    field: "balance_lovelace";
    blockfrost: string;
    koios: string | null;
    matches: boolean | null;
  };
  method: string[];
  scoringRules: string[];
  sources: SourceRecord[];
}

interface BfAmount {
  unit: string;
  quantity: string;
}
interface BfAddress {
  address: string;
  amount: BfAmount[];
  stake_address: string | null;
  script: boolean;
}
interface BfTotal {
  tx_count: number;
}
interface BfAddressTx {
  tx_hash: string;
  block_time: number;
}
interface BfAccount {
  pool_id: string | null;
  active: boolean;
}
interface BfTxUtxos {
  inputs: { address: string }[];
  outputs: { address: string }[];
}
interface KoiosAddressInfo {
  balance: string;
}

export interface BuildReportOptions {
  chain: ChainClient;
  /** Seconds since epoch; injected so scoring is reproducible. */
  now?: number;
}

export async function buildReport(input: string, { chain, now }: BuildReportOptions): Promise<Report> {
  const nowSeconds = now ?? Math.floor(Date.now() / 1000);
  const subject = await resolveSubject(input, chain);
  const address = subject.address;

  const info = await chain.blockfrost<BfAddress>(`/addresses/${address}`);
  const found = info !== null;
  const amounts = info?.amount ?? [];
  const lovelace = BigInt(amounts.find((a) => a.unit === "lovelace")?.quantity ?? "0");
  const tusdm = amounts.filter((a) => (TUSDM_UNITS as readonly string[]).includes(a.unit)).reduce((s, a) => s + BigInt(a.quantity), 0n);
  const tokenKinds = amounts.filter((a) => a.unit !== "lovelace").length;

  let txCount = 0;
  let firstSeen: number | null = null;
  let recent: BfAddressTx[] = [];
  let delegatedPool: string | null = null;
  const counterparties = new Map<string, number>();

  if (found) {
    const stake = subject.stakeAddress ?? info.stake_address;
    const [total, first, latest, account] = await Promise.all([
      chain.blockfrost<BfTotal>(`/addresses/${address}/total`),
      chain.blockfrost<BfAddressTx[]>(`/addresses/${address}/transactions?order=asc&count=1`),
      chain.blockfrost<BfAddressTx[]>(`/addresses/${address}/transactions?order=desc&count=${RECENT_WINDOW}`),
      stake ? chain.blockfrost<BfAccount>(`/accounts/${stake}`) : Promise.resolve(null),
    ]);
    txCount = total?.tx_count ?? 0;
    firstSeen = first?.[0]?.block_time ?? null;
    recent = latest ?? [];
    delegatedPool = account?.active ? account.pool_id : null;

    const sample = recent.slice(0, COUNTERPARTY_SAMPLE);
    const utxoSets = await Promise.all(sample.map((tx) => chain.blockfrost<BfTxUtxos>(`/txs/${tx.tx_hash}/utxos`, [tx.tx_hash])));
    for (const utxos of utxoSets) {
      const seen = new Set<string>();
      for (const io of [...(utxos?.inputs ?? []), ...(utxos?.outputs ?? [])]) {
        if (io.address !== address) seen.add(io.address);
      }
      for (const other of seen) counterparties.set(other, (counterparties.get(other) ?? 0) + 1);
    }
  }

  const top = [...counterparties.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([address, transactions]) => ({ address, transactions }));
  const [agent, counterpartyRisk] = found
    ? await Promise.all([detectRegisteredAgent(address, chain), assessCounterparties(top, chain)])
    : [null, [] as CounterpartyRisk[]];

  let koiosBalance: string | null = null;
  try {
    const k = await chain.koios<KoiosAddressInfo[]>("/address_info", { _addresses: [address] });
    koiosBalance = k[0]?.balance ?? (found ? null : "0");
  } catch {
    // The cross-check is advisory; the report says it could not be confirmed.
    koiosBalance = null;
  }
  const crossCheckMatches = koiosBalance === null ? null : BigInt(koiosBalance) === lovelace;

  const lastSeen = recent[0]?.block_time ?? null;
  const facts: Facts = {
    found,
    isScript: info?.script ?? false,
    hasStakeKey: Boolean(subject.stakeAddress ?? info?.stake_address),
    balanceLovelace: lovelace,
    tokenKinds,
    txCount,
    firstSeen,
    lastSeen,
    txsLast24h: recent.filter((t) => nowSeconds - t.block_time <= 86_400).length,
    txsLast30d: recent.filter((t) => nowSeconds - t.block_time <= 30 * 86_400).length,
    delegatedPool,
    crossCheckMatches,
    isRegisteredAgent: agent !== null,
    thinCounterparties: counterpartyRisk.filter((c) => c.thin).length,
  };
  const score = scoreFacts(facts, nowSeconds);

  const iso = (s: number | null) => (s === null ? null : new Date(s * 1000).toISOString());
  return {
    version: REPORT_VERSION,
    generatedAt: new Date(nowSeconds * 1000).toISOString(),
    subject,
    agent,
    counterpartyRisk,
    facts: {
      found,
      isScript: facts.isScript,
      balanceAda: formatAda(lovelace),
      tusdmBalance: formatTusdm(tusdm),
      tokenKinds,
      txCount,
      firstSeen: iso(firstSeen),
      lastSeen: iso(lastSeen),
      ageDays: firstSeen === null ? null : Math.floor((nowSeconds - firstSeen) / 86_400),
      txsLast24h: facts.txsLast24h,
      txsLast30d: facts.txsLast30d,
      txsLast30dCapped: recent.length === RECENT_WINDOW && facts.txsLast30d === RECENT_WINDOW,
      delegatedPool,
      topCounterparties: top,
    },
    score,
    crossCheck: { field: "balance_lovelace", blockfrost: lovelace.toString(), koios: koiosBalance, matches: crossCheckMatches },
    method: [
      subject.kind === "payment-address"
        ? "Checked the payment address as given."
        : `Resolved the ${subject.kind === "handle" ? "ADA Handle" : "stake address"} to the payment address it controls.`,
      `Read balance, transaction count, first and last ${RECENT_WINDOW} transactions, and stake delegation from Blockfrost (Cardano preprod).`,
      `Counterparties are the other addresses in the ${COUNTERPARTY_SAMPLE} most recent transactions.`,
      "Cross-checked the ADA balance against Koios, an independent indexer.",
      "Looked for a Masumi registry token at the address, which identifies it as a registered AI agent and reveals what it claims to do.",
      "Checked each main counterparty's own history, so a clean-looking wallet surrounded by brand-new ones is not reported as safe.",
    ],
    scoringRules: SCORING_RULES,
    sources: chain.sources,
  };
}
