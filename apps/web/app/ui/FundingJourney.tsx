import seed from "../../../../docs/evidence/funding/seed-round.json";
import { cardanoscan } from "@agentfund/shared";
import type { CardanoActivity } from "../../lib/cardano-activity";
import { short, tusdm } from "../../lib/present";

export function FundingJourney({ activity }: { activity: CardanoActivity | null }) {
  const fundedAt = "fundedAt" in seed ? Date.parse(String(seed.fundedAt)) / 1000 : Infinity;
  const payouts = activity?.splits.filter(s => s.time >= fundedAt && BigInt(s.investor) > 0n) ?? [];
  return <details className="funding-journey">
    <summary>Seed funding · 2 test ADA for a 10% share</summary>
    <ol>
      <li><b>Share allocated:</b> the existing investor’s 10% is fixed in this contract’s address.</li>
      <li><b>Capital received:</b> {seed.state === "funded" ? "2 test ADA independently verified at Atlas’s wallet" : "Funding has not been verified"}.
        {"txHash" in seed && <a className="mono" href={cardanoscan.tx(String(seed.txHash))} target="_blank" rel="noreferrer"> {short(String(seed.txHash))} ↗</a>}</li>
      <li><b>Revenue:</b> agent payments go to the contract; Masumi collections depend on the operator sweep.</li>
      <li><b>Payout after funding:</b> {payouts.length ? payouts.map(p => <span key={p.txHash}> {tusdm(p.investor)} tUSDM · <a className="mono" href={cardanoscan.tx(p.txHash)} target="_blank" rel="noreferrer">{short(p.txHash)} ↗</a></span>) : "Not yet verified in this chain snapshot"}.</li>
    </ol>
    <p>This is a closed seed demonstration, not an open investment offer. New investors require a new deal address. No principal guarantee, repayment cap or transferable share token is implemented.</p>
    <p className="mono">Terms fingerprint: {seed.termsHash}</p>
  </details>;
}
