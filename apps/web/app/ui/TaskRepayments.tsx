import { cardanoscan } from "@agentfund/shared";
import type { CoworkerTask } from "../../lib/sokosumi";
import type { TaskRepayment } from "../../lib/task-repayment";
import { short, tusdm } from "../../lib/present";

const LABELS = { distributed: "Investor payout verified", locked: "Reached the contract · payout not verified", "awaiting-sweep": "Collected · sweep not verified", unverified: "Repayment needs verification" };

function Tx({ hash }: { hash: string }) {
  return <a className="mono hashlink" href={cardanoscan.tx(hash)} target="_blank" rel="noreferrer">{short(hash)} ↗</a>;
}

export function TaskRepayments({ tasks, repayments }: { tasks: CoworkerTask[] | null; repayments: Record<string, TaskRepayment> }) {
  const collected = (tasks ?? []).filter(t => t.paid && t.collectionTx);
  if (!collected.length) return null;
  return <div className="task-repayments">
    {collected.map(t => {
      const proof = repayments[t.taskId];
      const paths = [...new Map((proof?.paths ?? []).map(p => [`${p.sweepTx}#${p.sweepIndex}`, p])).values()];
      const batches = [...new Map(paths.filter(p => p.investorPaid !== null).map(p => [p.splitTx, p])).values()];
      return <article className="repayment-card" key={t.taskId}>
        <div className="repayment-heading"><b>{proof ? LABELS[proof.status] : "Repayment needs verification"}</b><span className="mono" title={t.taskId}>Task {short(t.taskId)}</span></div>
        <ol className="repayment-trail">
          <li className={t.resultHash && t.delivered ? "verified" : "pending"}><b>Report</b><span>{t.resultHash && t.delivered ? "Recorded by the worker" : "Delivery not verified"}</span>{t.resultHash && <span className="mono" title={t.resultHash}>{short(t.resultHash)}</span>}</li>
          <li className={proof?.collected ? "verified" : "pending"}><b>Collection</b><span>{proof?.collected ? `${tusdm(proof.collected)} tUSDM` : "Worker receipt · chain check unavailable"}</span><Tx hash={t.collectionTx!} /></li>
          <li className={proof && ["locked", "distributed"].includes(proof.status) ? "verified" : "pending"}><b>Sweep</b>{paths.length ? paths.map(p => <div key={`${p.sweepTx}#${p.sweepIndex}`}><span>{tusdm(p.swept)} tUSDM · batch</span><Tx hash={p.sweepTx} /></div>) : <span>Direct output link not verified</span>}</li>
          <li className={proof?.status === "distributed" ? "verified" : "pending"}><b>Payout</b>{batches.length ? batches.map(p => <div key={p.splitTx!}><span>Investor: {tusdm(p.investorPaid!)} tUSDM</span><span>Atlas: {tusdm(p.atlasPaid!)} tUSDM</span><Tx hash={p.splitTx!} /></div>) : <span>No verified investor payout yet</span>}</li>
        </ol>
        <div className="repayment-foot"><span>Masumi tUSDM · payouts are batch totals</span></div>
        <details><summary>View repayment evidence</summary><p className="repayment-note">{proof?.note ?? "Chain evidence is unavailable."}</p><p>Escrow collects into the selling wallet; the contract protects the investor after the sweep.</p><p>The collection's wallet output must be an input to the sweep. The sweep's contract output must be an input to the paying batch. Both investor and Atlas payouts are checked in the Masumi asset, excluding wallet change. Payout figures are batch totals; a batch may include other Tasks.</p><p className="mono">Task: {t.taskId}<br />Payment event: {t.purchaseEventId ?? "Not recorded"}<br />Completion event: {t.completionEventId ?? "Not recorded"}</p></details>
      </article>;
    })}
  </div>;
}
