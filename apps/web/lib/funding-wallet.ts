import type { FundingTicket } from "./funding-types";
export type PendingFunding = FundingTicket & { signedCbor?: string; submitted?: boolean };
export interface FundingWallet { getNetworkId(): Promise<number>; getChangeAddress(): Promise<string>; signTx(cbor: string, partial: boolean): Promise<string>; submitTx(cbor: string): Promise<string> }
/** Persist before broadcast. A reconnect/retry must submit the same bytes, never rebuild. */
export async function submitFunding(pending: PendingFunding, wallet: FundingWallet, api: (body: unknown) => Promise<any>, persist: (p: PendingFunding) => void) {
  if (await wallet.getNetworkId() !== 0) throw new Error("Switch your wallet to Cardano preprod");
  const d = await api({ action: "connect", address: await wallet.getChangeAddress() });
  if (d.address !== pending.address) throw new Error("This proposal belongs to a different wallet account");
  let p = pending;
  if (!p.signedCbor) {
    if (Date.now() >= p.expiresAt) throw new Error("Unsigned proposal expired. Discard it and prepare again.");
    const witnesses = await wallet.signTx(p.cbor, true);
    const signed = await api({ action: "assemble", id: p.id, witnesses });
    if (signed.txHash !== p.txHash) throw new Error("Signature assembly changed the transaction identity");
    p = { ...p, signedCbor: signed.signedCbor };
    persist(p);
  }
  const hash = await wallet.submitTx(p.signedCbor!);
  if (hash !== p.txHash) throw new Error("Wallet returned an unexpected transaction hash. Inspect before continuing.");
  persist({ ...p, submitted: true });
}
