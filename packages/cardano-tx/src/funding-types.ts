export type FundingAction = "open" | "fund" | "distribute" | "cancel";
export interface FundingView {
  id: string; address: string; serviceUrl: string; stage: "opening" | "offered" | "active" | "closed" | "cancelled" | "unavailable";
  operator: string; investor?: string; capital: string; bps: number; cap: string; earned: string; paid: string; waiting: string;
  error?: string;
}
export interface FundingTicket {
  id: string; roundId: string; action: FundingAction; address: string;
  terms: { capital: string; bps: number; cap: string; operator: string };
  proposalState?: "unsigned" | "assembled" | "discarded";
  cbor: string; txHash: string; expiresAt: number; fee: string;
}
