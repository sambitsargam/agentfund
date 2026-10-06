import { formatTusdm } from "@agentfund/shared";

export const tusdm = (baseUnits: string | bigint) => formatTusdm(BigInt(baseUnits));

const FLAG_WORDS: [number, string][] = [
  [1 << 0, "The money was going to an address outside the investor contract."],
  [1 << 1, "The payment was set up with a different contract than the one investors signed."],
  [1 << 2, "The payment used a token that is not allowed."],
  [1 << 3, "The amount was higher than the agent's price limit."],
  [1 << 4, "Atlas's rating was below the minimum."],
  [1 << 5, "Atlas's rating was too old to trust."],
  [1 << 6, "The investor contract could not be found on Cardano."],
  [1 << 7, "An AI auditor objected to the payment."],
  [1 << 8, "An AI auditor was not confident enough to approve."],
  [1 << 9, "An AI auditor gave an unreadable answer, so the gate held the payment."],
];

export const flagWords = (flags: number) => FLAG_WORDS.filter(([bit]) => flags & bit).map(([, words]) => words);

/** Same formula as workflows/rating (see its README): out of 1000. */
export function scoreParts(earnings: bigint, txCount: number, probeOk: boolean, latencyMs: number) {
  const e = Number((400n * (earnings < 10_000_000n ? earnings : 10_000_000n)) / 10_000_000n);
  const a = Math.floor((300 * Math.min(txCount, 20)) / 20);
  const p = probeOk ? 200 : 0;
  const l = !probeOk ? 0 : latencyMs < 2000 ? 100 : latencyMs < 5000 ? 50 : 0;
  return [
    { label: "Money earned (up to 400, full at 10 tUSDM)", points: e },
    { label: "Payments received (up to 300, full at 20)", points: a },
    { label: "Service answered a live check", points: p },
    { label: "Answered quickly", points: l },
  ];
}

export function ago(unixSeconds: number, now = Date.now()): string {
  const s = Math.max(0, Math.round(now / 1000 - unixSeconds));
  if (s < 90) return `${s} seconds ago`;
  if (s < 5400) return `${Math.round(s / 60)} minutes ago`;
  if (s < 129600) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export const short = (hash: string) => `${hash.slice(0, 8)}…${hash.slice(-6)}`;
