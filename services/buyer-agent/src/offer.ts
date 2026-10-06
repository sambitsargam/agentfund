import { keccak256, type Hex } from "viem";

/** The parts of an x402 offer the gate approves and the buyer later insists on. */
export interface Offer {
  payTo: string;
  asset: string;
  amount: string;
  scriptCode: string;
}

export interface PaymentProposal extends Offer {
  requestId: Hex;
  agentId: string;
  resource: string;
}

interface RawRequirement {
  payTo: string;
  asset: string;
  amount: string;
  extra?: { script?: { code?: string } };
}

export function offerFrom(req: RawRequirement): Offer {
  const scriptCode = req.extra?.script?.code;
  if (!scriptCode) throw new Error("offer does not use the script transfer method");
  return { payTo: req.payTo, asset: req.asset, amount: req.amount, scriptCode: scriptCode.toLowerCase() };
}

export function sameOffer(a: Offer, b: Offer): boolean {
  return (
    a.payTo === b.payTo &&
    a.asset === b.asset &&
    a.amount === b.amount &&
    keccak256(`0x${a.scriptCode}`) === keccak256(`0x${b.scriptCode}`)
  );
}

/** Reads the 402 for a resource without paying, returning its first offer. */
export async function fetchOffer(resource: string, fetchImpl: typeof fetch = fetch): Promise<Offer> {
  const res = await fetchImpl(resource);
  if (res.status !== 402) {
    const detail = await res.text().catch(() => "");
    throw new Error(`expected 402 from ${resource}, got ${res.status} ${detail.slice(0, 200)}`);
  }
  const header = res.headers.get("payment-required");
  if (!header) throw new Error("402 without a PAYMENT-REQUIRED header");
  const required = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as { accepts: RawRequirement[] };
  const first = required.accepts[0];
  if (!first) throw new Error("402 lists no payment options");
  return offerFrom(first);
}

/** For the tamper demo: the same offer, but paying somewhere else. */
export function tampered(p: PaymentProposal, payTo: string): PaymentProposal {
  return { ...p, payTo };
}

export class Budget {
  private spent = 0n;
  constructor(private readonly limit: bigint) {}

  get remaining(): bigint {
    return this.limit - this.spent;
  }

  reserve(amount: bigint): void {
    if (amount > this.remaining) throw new Error(`budget exceeded: ${amount} requested, ${this.remaining} left`);
    this.spent += amount;
  }

  release(amount: bigint): void {
    this.spent -= amount;
  }
}
