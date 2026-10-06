import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { scoreFacts, type Facts } from "../src/score.js";

const fixture = JSON.parse(readFileSync(new URL("../src/data/public-threats.json", import.meta.url), "utf8")) as {
  sourceCommit: string; source: string; labelMeaning: string; rows: { address: string; label: string; source: string }[];
};
const now = Math.floor(Date.now() / 1000);
const dir = fileURLToPath(new URL("../../../docs/evidence/public-threats/", import.meta.url));
mkdirSync(dir, { recursive: true });
async function query<T>(path: string, addresses: string[]): Promise<T> {
  const r = await fetch(`https://api.koios.rest/api/v1/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ _addresses: addresses }), signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Public indexer returned ${r.status}`);
  return r.json() as Promise<T>;
}
type Info = { address: string; balance: string; stake_address: string | null; script_address: boolean; utxo_set: { asset_list: { policy_id: string; asset_name: string }[] }[] };
type Tx = { tx_hash: string; block_time: number };
const cases = [];
for (const row of fixture.rows) {
  try {
    const [info, first, recent] = await Promise.all([
      query<Info[]>("address_info", [row.address]),
      query<Tx[]>("address_txs?order=block_time.asc&limit=1", [row.address]),
      query<Tx[]>("address_txs?order=block_time.desc&limit=1000", [row.address]),
    ]);
    const i = info[0];
    const facts: Facts = { found: Boolean(i), isScript: i?.script_address ?? false, hasStakeKey: Boolean(i?.stake_address), balanceLovelace: BigInt(i?.balance ?? "0"),
      tokenKinds: new Set((i?.utxo_set ?? []).flatMap(u => u.asset_list.map(a => a.policy_id + a.asset_name))).size,
      txCount: recent.length, firstSeen: first[0]?.block_time ?? null, lastSeen: recent[0]?.block_time ?? null,
      txsLast24h: recent.filter(t => now - t.block_time <= 86400).length, txsLast30d: recent.filter(t => now - t.block_time <= 30 * 86400).length,
      delegatedPool: null, crossCheckMatches: null, isRegisteredAgent: false, thinCounterparties: 0 };
    const score = scoreFacts(facts, now);
    cases.push({ ...row, facts: { ...facts, balanceLovelace: facts.balanceLovelace.toString() }, historyVerdict: score.verdict, historyWarningIndex: score.risk,
      highWarning: score.verdict === "high", firstTx: first[0]?.tx_hash, lastTx: recent[0]?.tx_hash, sampleCapped: recent.length === 1000 });
    console.log(`Public threat sample ${cases.length}/${fixture.rows.length}: history ${score.verdict} (${score.risk})`);
  } catch { cases.push({ ...row, error: "Public chain evidence unavailable; excluded from diagnostic denominator" }); }
}
const available = cases.filter(c => !("error" in c));
const high = available.filter(c => "highWarning" in c && c.highWarning).length;
const result = {
  generatedAt: new Date().toISOString(), sourceCommit: fixture.sourceCommit, source: fixture.source, labelMeaning: fixture.labelMeaning,
  scope: "Read-only public mainnet history diagnostic. Production reports and all payment operations remain preprod. This is NOT full Atlas fraud-detection validation.",
  limitations: ["Positive-only six-address convenience sample; no legitimate control cohort, so precision, false-positive rate and fraud accuracy cannot be estimated.",
    "External registry labels are threat associations, not independently adjudicated fraud outcomes.",
    "Current histories are observed after reporting; this is not prospective prediction. Correlated entries must not be treated as independent incidents.",
    "This diagnostic uses core history only: counterparty analysis, delegation and independent balance agreement were not assessed. Preprod thresholds are not calibrated for mainnet.",
    "Unlisted does not mean safe. Addresses may change ownership. No thresholds were tuned using this sample."],
  counts: { listed: fixture.rows.length, available: available.length, highHistoryWarnings: high, missedOrAbstained: available.length - high, unavailable: cases.length - available.length },
  fraudAccuracy: null, precision: null, falsePositiveRate: null,
  conclusion: "History heuristics alone cannot establish whether a payment recipient is trustworthy. Report source-listed threat associations separately from the experimental warning index.", cases,
};
writeFileSync(`${dir}/diagnostic.json`, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result.counts));
