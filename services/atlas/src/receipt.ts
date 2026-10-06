import { createHash } from "node:crypto";
import { Data } from "@evolution-sdk/evolution";

const REQUEST_ID = /^[0-9a-f]{64}$/;

/**
 * The id that ties a payment to one report request. Buyers that go through the CRE payment
 * gate send their own (the gate's decision is keyed by it); otherwise it is derived from the
 * subject and the UTC day, so the 402 and the paid retry describe the same requirements.
 */
export function requestIdFor(subject: string, explicit: string | undefined, now = new Date()): string {
  if (explicit !== undefined) {
    const id = explicit.toLowerCase();
    if (!REQUEST_ID.test(id)) throw new Error("requestId must be 32 bytes of hex");
    return id;
  }
  const day = now.toISOString().slice(0, 10);
  return createHash("sha256").update(`atlas-report:${subject.trim()}:${day}`).digest("hex");
}

/** Inline datum on the payment output: Constr 0 [request id]. The splitter ignores it; indexers read it. */
export function receiptDatum(requestId: string): string {
  return Data.toCBORHex(Data.constr(0n, [Data.bytearray(requestId)]));
}
