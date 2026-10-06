import { keccak256, type Hex } from "viem";

/** What a buyer agent asks the gate to approve, built from Atlas's 402 offer. */
export type PaymentProposal = {
  requestId: Hex;
  agentId: string;
  resource: string;
  payTo: string;
  asset: string;
  amount: string;
  scriptCode: string;
};

export type AuditorVerdict = "allow" | "deny" | "review";

export type AuditorResult = {
  auditor: string;
  verdict: AuditorVerdict;
  confidence: number;
  reasons: string[];
  malformed: boolean;
};

export type Verdict = "ALLOW" | "DENY" | "REVIEW";

export type GatePolicy = {
  splitterAddress: string;
  splitterCodeHash: Hex;
  allowedAssets: string[];
  maxAmount: string;
  minScore: number;
  maxRatingAgeSeconds: number;
  minAuditorConfidence: number;
};

export type StoredRating = { score: number; observedAt: bigint };

/** Bit positions written on-chain as `riskFlags`, so a Deny or Review says why. */
export const FLAG = {
  payToMismatch: 1 << 0,
  scriptMismatch: 1 << 1,
  assetNotAllowed: 1 << 2,
  amountTooHigh: 1 << 3,
  ratingTooLow: 1 << 4,
  ratingStale: 1 << 5,
  splitterNotOnChain: 1 << 6,
  auditorObjected: 1 << 7,
  auditorUnsure: 1 << 8,
  auditorMalformed: 1 << 9,
} as const;

/** A wrong destination or contract is never a judgement call. */
const DENY_FLAGS = FLAG.payToMismatch | FLAG.scriptMismatch | FLAG.assetNotAllowed | FLAG.amountTooHigh;

const HEX32 = /^0x[0-9a-f]{64}$/;
const HEX = /^[0-9a-f]+$/;

export function parseProposal(raw: string): PaymentProposal {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("proposal is not JSON");
  }
  const str = (k: string) => {
    const v = value[k];
    if (typeof v !== "string" || v.length === 0) throw new Error(`proposal.${k} is required`);
    return v;
  };
  const requestId = str("requestId").toLowerCase();
  if (!HEX32.test(requestId)) throw new Error("proposal.requestId must be 0x-prefixed 32-byte hex");
  const amount = str("amount");
  if (!/^\d+$/.test(amount)) throw new Error("proposal.amount must be an integer string");
  const scriptCode = str("scriptCode").toLowerCase();
  if (!HEX.test(scriptCode) || scriptCode.length % 2 !== 0) throw new Error("proposal.scriptCode must be hex");
  return {
    requestId: requestId as Hex,
    agentId: str("agentId"),
    resource: str("resource"),
    payTo: str("payTo"),
    asset: str("asset"),
    amount,
    scriptCode,
  };
}

/** Checks that need no network: is the money going to the investor contract, in the right asset? */
export function bindingFlags(p: PaymentProposal, policy: GatePolicy): number {
  let flags = 0;
  if (p.payTo !== policy.splitterAddress) flags |= FLAG.payToMismatch;
  if (keccak256(`0x${p.scriptCode}`) !== policy.splitterCodeHash.toLowerCase()) flags |= FLAG.scriptMismatch;
  if (!policy.allowedAssets.includes(p.asset)) flags |= FLAG.assetNotAllowed;
  if (BigInt(p.amount) > BigInt(policy.maxAmount)) flags |= FLAG.amountTooHigh;
  return flags;
}

export function ratingFlags(r: StoredRating, policy: GatePolicy, nowSeconds: bigint): number {
  let flags = 0;
  if (r.score < policy.minScore) flags |= FLAG.ratingTooLow;
  if (r.observedAt === 0n || nowSeconds - r.observedAt > BigInt(policy.maxRatingAgeSeconds)) flags |= FLAG.ratingStale;
  return flags;
}

/**
 * Auditors must answer {verdict, confidence 0-100, reasons[]}. Anything else, including prose around
 * the JSON, is treated as an unsure answer so a confused model can never produce an Allow.
 */
export function parseAuditorOutput(auditor: string, text: string): AuditorResult {
  const malformed = (why: string): AuditorResult => ({
    auditor,
    verdict: "review",
    confidence: 0,
    reasons: [`malformed auditor output: ${why}`],
    malformed: true,
  });
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(text.trim()) as Record<string, unknown>;
  } catch {
    return malformed("not JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return malformed("not an object");
  const { verdict, confidence, reasons } = value;
  if (verdict !== "allow" && verdict !== "deny" && verdict !== "review") return malformed("bad verdict");
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
    return malformed("bad confidence");
  }
  if (!Array.isArray(reasons) || !reasons.every((r) => typeof r === "string")) return malformed("bad reasons");
  return { auditor, verdict, confidence, reasons: reasons as string[], malformed: false };
}

export function auditorFlags(results: AuditorResult[], policy: GatePolicy): number {
  let flags = 0;
  for (const r of results) {
    if (r.malformed) flags |= FLAG.auditorMalformed;
    else if (r.verdict === "deny") flags |= FLAG.auditorObjected;
    else if (r.verdict === "review" || r.confidence < policy.minAuditorConfidence) flags |= FLAG.auditorUnsure;
  }
  return flags;
}

/** Deny on a wrong destination or asset; Allow only when nothing at all was flagged; otherwise Review. */
export function decide(flags: number): Verdict {
  if (flags & DENY_FLAGS) return "DENY";
  return flags === 0 ? "ALLOW" : "REVIEW";
}

export const VERDICT_CODE: Record<Verdict, number> = { ALLOW: 1, DENY: 2, REVIEW: 3 };

export function describeFlags(flags: number): string[] {
  return (Object.keys(FLAG) as (keyof typeof FLAG)[]).filter((k) => flags & FLAG[k]);
}
