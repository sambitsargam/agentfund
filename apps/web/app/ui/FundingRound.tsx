import round from "../../../../docs/samples/round-verification.json";
import { cardanoscan } from "@agentfund/shared";
import { short, tusdm } from "../../lib/present";

const STEP: Record<string, string> = {
  open: "Round opened",
  fund: "Investor funded it",
  revenue: "Our buyer agent paid for a report",
  distribute: "Investor paid first",
};

/**
 * A complete round, on chain: the share activates only once capital lands, and it stops
 * once the cap is repaid. Every figure is a net flow read back from the chain.
 */
export function FundingRound() {
  const cap = BigInt(round.terms.cap);
  const repaid = BigInt(round.totalRepaid);
  const capital = BigInt(round.capitalPaid);
  const pct = round.terms.bps / 100;

  return (
    <div className="round">
      <div className="round-head">
        <div>
          <h3>A funding round that finished itself</h3>
          <p>
            {tusdm(capital)} tUSDM of capital for a {pct}% share of what this
            round earns, repaid up to {tusdm(cap)} tUSDM. The payments came from
            our own buyer agent over x402, so this shows the mechanism rather
            than outside demand. The contract closed the deal the moment the cap
            was reached.
          </p>
        </div>
        <span className={`round-badge ${round.capReached ? "done" : ""}`}>
          {round.capReached ? "Cap reached · closed" : "Active"}
        </span>
      </div>

      <div
        className="round-bar"
        aria-label={`${tusdm(repaid)} of ${tusdm(cap)} tUSDM repaid`}
      >
        <i style={{ width: `${Number((repaid * 100n) / cap)}%` }} />
        <b>
          {tusdm(repaid)} / {tusdm(cap)} tUSDM repaid
        </b>
      </div>

      <ol className="round-steps">
        {round.steps.map((s) => {
          const inv = BigInt(s.investorNet);
          return (
            <li key={s.txHash}>
              <span className="round-step">{STEP[s.action] ?? s.action}</span>
              <span className="round-amt">
                {inv > 0n
                  ? `investor +${tusdm(inv)} tUSDM`
                  : inv < 0n
                    ? `investor −${tusdm(-inv)} tUSDM`
                    : "nothing to the investor"}
              </span>
              <a
                className="mono"
                href={cardanoscan.tx(s.txHash)}
                target="_blank"
                rel="noreferrer"
              >
                {short(s.txHash)} ↗
              </a>
            </li>
          );
        })}
      </ol>

      <details className="round-more">
        <summary>How this differs from the fixed deal above</summary>
        <p>
          In the fixed deal, the investor&rsquo;s 10% is a parameter of the
          splitter&rsquo;s script hash: it is always taken, with no start and no
          end. A round is a lifecycle. The share is <b>inactive</b> until the
          investor&rsquo;s capital reaches the operator, so an unfunded promise
          earns nothing. Payouts are tracked cumulatively in the round&rsquo;s
          datum and <b>stop at the cap</b> — the last payout here was{" "}
          {tusdm(
            BigInt(
              round.steps.filter((s) => s.action === "distribute").at(-2)
                ?.investorNet ?? "0",
            ),
          )}{" "}
          tUSDM rather than a full share, because that is all that was still
          owed. Afterwards the round is closed and further revenue passes
          through untouched, which the final two transactions show.
        </p>
        <p className="muted small">
          Round address <span className="mono">{round.address}</span>.{" "}
          {round.scope}
        </p>
      </details>
    </div>
  );
}
