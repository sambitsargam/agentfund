import { InvalidInputError } from "./subject.js";
import { cardanoscan } from "./explorer.js";
import type { Report } from "./report.js";

const VERDICT_LABEL: Record<Report["score"]["verdict"], string> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
  unknown: "Unknown",
};

const short = (address: string) => `${address.slice(0, 14)}…${address.slice(-6)}`;

/** Renders a report for a team chat thread: verdict first, then facts, flags, method and sources. */
export function renderReportMarkdown(r: Report): string {
  const f = r.facts;
  const s = r.subject;
  const lines: string[] = [];

  lines.push(`**${VERDICT_LABEL[r.score.verdict]} (${r.score.risk}/100)** · ${r.score.headline}`, "");
  const label = s.handle
    ? `${s.handle} → ${short(s.address)}`
    : s.kind === "stake-address" && s.stakeAddress
      ? `${short(s.stakeAddress)} (stake address) → ${short(s.address)}`
      : short(s.address);
  lines.push(`Checked: [${label}](${cardanoscan.address(s.address)}) on Cardano preprod, ${r.generatedAt.replace("T", " ").slice(0, 16)} UTC`, "");

  lines.push("### Key facts", "");
  if (!f.found) {
    lines.push("- No transactions have ever touched this address.");
  } else {
    lines.push(`- **First used:** ${f.firstSeen?.slice(0, 10) ?? "unknown"}${f.ageDays === null ? "" : f.ageDays === 0 ? " (today)" : ` (${f.ageDays} day${f.ageDays === 1 ? "" : "s"} ago)`}`);
    lines.push(`- **Last active:** ${f.lastSeen?.slice(0, 10) ?? "unknown"}`);
    lines.push(`- **Transactions:** ${f.txCount} in total, ${f.txsLast30d}${f.txsLast30dCapped ? "+" : ""} in the last 30 days`);
    lines.push(`- **Balance:** ${f.balanceAda} ADA${f.tusdmBalance !== "0" ? `, ${f.tusdmBalance} tUSDM` : ""}${f.tokenKinds ? `, ${f.tokenKinds} ${f.tokenKinds === 1 ? "kind" : "kinds"} of token` : ""}`);
    lines.push(`- **Wallet type:** ${f.isScript ? "smart contract" : "regular wallet"}${s.stakeAddress ? `, staking key ${short(s.stakeAddress)}` : ", no staking key"}`);
    lines.push(`- **Stake delegation:** ${f.delegatedPool ? `[${short(f.delegatedPool)}](${cardanoscan.pool(f.delegatedPool)})` : "not delegated"}`);
    if (f.topCounterparties.length) {
      const top = f.topCounterparties.map((c) => `[${short(c.address)}](${cardanoscan.address(c.address)}) (${c.transactions})`);
      lines.push(`- **Seen most often with:** ${top.join(", ")}`);
    }
  }
  lines.push("");

  lines.push("### Red flags", "");
  if (r.score.redFlags.length === 0) lines.push("- None found.");
  for (const flag of r.score.redFlags) lines.push(`- ${flag.message}`);
  if (r.score.goodSigns.length) {
    lines.push("", "### Good signs", "");
    for (const g of r.score.goodSigns) lines.push(`- ${g}`);
  }
  lines.push("");

  const cc = r.crossCheck;
  lines.push("### Accuracy check", "");
  lines.push(
    cc.matches === null
      ? "- Koios was unreachable, so the balance was not independently confirmed."
      : cc.matches
        ? `- Balance confirmed by two independent sources (Blockfrost and Koios agree on ${cc.blockfrost} lovelace).`
        : `- Blockfrost (${cc.blockfrost}) and Koios (${cc.koios}) disagree on the balance. Treat the facts above with care.`,
    "",
  );

  lines.push("### How this was checked", "");
  for (const m of r.method) lines.push(`- ${m}`);
  lines.push("", `Scoring: ${r.scoringRules.join(" ")}`, "");

  const txs = [...new Set(r.sources.flatMap((x) => x.txHashes ?? []))];
  lines.push("### Sources", "");
  lines.push(`- ${r.sources.length} queries to ${[...new Set(r.sources.map((x) => x.provider))].join(" and ")}: ${[...new Set(r.sources.map((x) => x.endpoint.split("?")[0]!.replace(/(addr_test1|stake_test1)\w+/, ":address").replace(/[0-9a-f]{64}/, ":tx")))].join(", ")}`);
  for (const h of txs) lines.push(`- Transaction [${h.slice(0, 12)}…](${cardanoscan.tx(h)})`);

  return lines.join("\n") + "\n";
}

export function renderInputHelpMarkdown(err: InvalidInputError): string {
  return [
    `**Could not run the check.** ${err.message}`,
    "",
    err.hint,
    "",
    "Examples:",
    "- `addr_test1qr…` (a payment address)",
    "- `stake_test1u…` (a stake address, to check the whole wallet)",
    "- `$myhandle` (an ADA Handle)",
    "",
  ].join("\n");
}

export function renderUpstreamFailureMarkdown(provider: string): string {
  return [
    "**Could not finish the check right now.**",
    "",
    `The chain data provider (${provider}) did not respond, so Atlas did not guess. Please send the same request again in a few minutes.`,
    "",
  ].join("\n");
}
