export interface Facts {
  found: boolean;
  isScript: boolean;
  hasStakeKey: boolean;
  balanceLovelace: bigint;
  tokenKinds: number;
  txCount: number;
  firstSeen: number | null;
  lastSeen: number | null;
  txsLast24h: number;
  txsLast30d: number;
  delegatedPool: string | null;
  crossCheckMatches: boolean | null;
  /** Registered as an AI agent on Masumi. */
  isRegisteredAgent: boolean;
  /** Counterparties with almost no history of their own. */
  thinCounterparties: number;
}

export type Severity = "high" | "medium" | "info";
export type Verdict = "low" | "medium" | "high" | "unknown";

export interface Finding {
  code: string;
  severity: Severity;
  points: number;
  message: string;
}

export interface Score {
  risk: number;
  verdict: Verdict;
  headline: string;
  redFlags: Finding[];
  goodSigns: string[];
}

const DAY = 86_400;

export const SCORING_RULES = [
  "Never used on preprod: risk 60, verdict unknown.",
  "First used under 1 day ago +35, under 7 days +25, under 30 days +10.",
  "Fewer than 3 transactions +15.",
  "10 or more transactions in the last 24 hours on an address under 7 days old +10.",
  "Inactive for more than 180 days +10.",
  "Smart contract address +15.",
  "No staking key on a normal wallet +5.",
  "Empty balance +5.",
  "Blockfrost and Koios disagree on the balance +10.",
  "Two or more of its main counterparties have almost no history +10.",
  "A smart contract that is a registered AI agent is treated as a normal wallet, not an unknown contract.",
  "Risk is capped at 100. 0–20 low, 21–45 medium, above 45 high.",
];

export function scoreFacts(f: Facts, nowSeconds: number): Score {
  if (!f.found) {
    return {
      risk: 60,
      verdict: "unknown",
      headline: "Unknown: this address has never been used on Cardano preprod, so there is no history to check.",
      redFlags: [
        {
          code: "never_used",
          severity: "high",
          points: 60,
          message: "No transactions at all. Confirm the address with the recipient through a second channel before sending.",
        },
      ],
      goodSigns: [],
    };
  }

  const flags: Finding[] = [];
  const good: string[] = [];
  const add = (code: string, severity: Severity, points: number, message: string) =>
    flags.push({ code, severity, points, message });

  const ageDays = f.firstSeen === null ? 0 : (nowSeconds - f.firstSeen) / DAY;
  if (ageDays < 1) add("brand_new", "high", 35, "First used less than a day ago. New addresses are common in scams and typo attacks.");
  else if (ageDays < 7) add("very_new", "high", 25, `First used ${Math.floor(ageDays)} days ago.`);
  else if (ageDays < 30) add("new", "medium", 10, `First used ${Math.floor(ageDays)} days ago.`);
  else if (ageDays >= 90) good.push(`In use for ${Math.floor(ageDays)} days.`);

  if (f.txCount < 3) add("little_history", "medium", 15, `Only ${f.txCount} transaction${f.txCount === 1 ? "" : "s"} so far.`);
  else if (f.txCount >= 50) good.push(`${f.txCount} transactions of history.`);

  if (f.txsLast24h >= 10 && ageDays < 7) {
    add("burst", "medium", 10, `${f.txsLast24h} transactions in the last 24 hours on a new address.`);
  }

  if (f.lastSeen !== null && (nowSeconds - f.lastSeen) / DAY > 180) {
    add("dormant", "medium", 10, `No activity for ${Math.floor((nowSeconds - f.lastSeen) / DAY)} days.`);
  } else if (f.txsLast30d > 0) {
    good.push(`Active in the last 30 days (${f.txsLast30d} transaction${f.txsLast30d === 1 ? "" : "s"}).`);
  }

  if (f.isRegisteredAgent) {
    good.push("Registered as an AI agent on Masumi, with its service and author recorded on-chain.");
  } else if (f.isScript) {
    add("smart_contract", "medium", 15, "This is a smart contract, not a person's wallet. Check what the contract does before paying it.");
  } else if (!f.hasStakeKey) {
    add("no_stake_key", "info", 5, "No staking key. Common for exchange and service wallets, unusual for a person.");
  }

  if (f.delegatedPool) good.push("Stake is delegated to a pool, which suggests an owner who manages the wallet.");
  if (f.balanceLovelace === 0n) add("empty", "info", 5, "The address is currently empty.");
  if (f.tokenKinds >= 3) good.push(`Holds ${f.tokenKinds} kinds of tokens.`);

  if (f.thinCounterparties >= 2) {
    add(
      "thin_counterparties",
      "medium",
      10,
      `${f.thinCounterparties} of the addresses it deals with most have almost no history of their own, which is a pattern seen in freshly built payment chains.`,
    );
  }

  if (f.crossCheckMatches === false) {
    add("sources_disagree", "medium", 10, "Two independent data sources disagree on the balance. Try again in a minute.");
  }

  const risk = Math.min(100, flags.reduce((sum, x) => sum + x.points, 0));
  const verdict: Verdict = risk <= 20 ? "low" : risk <= 45 ? "medium" : "high";
  const headline =
    verdict === "low"
      ? "Low risk: an established address with normal activity."
      : verdict === "medium"
        ? "Medium risk: verify with the recipient before sending a large amount."
        : "High risk: do not send money until you have confirmed this address another way.";

  return { risk, verdict, headline, redFlags: flags, goodSigns: good };
}
