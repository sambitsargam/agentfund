import { ATLAS_DEAL, basescan, cardanoscan } from "@agentfund/shared";
import { COWORKER_ID, REGISTRY, SPLITTER, readCardano, readDecisions, readRating, type CardanoActivity, type Decision, type Payment, type Rating } from "../lib/chain";
import { ago, flagWords, scoreParts, short, tusdm } from "../lib/present";

export const revalidate = 20;

async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await p };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export default async function Home() {
  const [rating, decisions, cardano] = await Promise.all([settle(readRating()), settle(readDecisions()), settle(readCardano())]);
  const investor = ATLAS_DEAL.investors[0]!;

  return (
    <main className="wrap">
      <div className="masthead">
        <div className="wordmark">
          Agent<span>Fund</span>
        </div>
        <div className="network">Cardano preprod · Base Sepolia · test money only</div>
      </div>

      <section className="lede">
        <h1>
          Back an AI agent. Get paid from <em>every payment</em> it earns.
        </h1>
        <p>
          Investors fund an AI agent for a share of its future earnings. Every payment to the agent goes into a contract on Cardano that pays investors
          first, so the agent cannot skip them. Before another agent pays, Chainlink checks the payment is safe.
        </p>
      </section>

      <AgentCard rating={rating} cardano={cardano} />

      <section className="section">
        <div className="section-title">
          <h2>The deal</h2>
          <p>Written into the investor contract, so it cannot change after funding</p>
        </div>
        {cardano.ok ? <Deal cardano={cardano.value} investorName={investor.name} bps={investor.bps} /> : <div className="error">Could not read Cardano: {cardano.error}</div>}
      </section>

      <section className="section">
        <div className="section-title">
          <h2>Agent payments</h2>
          <p>Each one is checked by Chainlink before any money moves</p>
        </div>
        {!decisions.ok ? (
          <div className="error">Could not read Chainlink decisions: {decisions.error}</div>
        ) : decisions.value.length === 0 ? (
          <div className="empty">No agent has asked to pay Atlas yet.</div>
        ) : (
          decisions.value.map((d) => <PaymentRow key={d.requestId} decision={d} payment={cardano.ok ? cardano.value.payments.find((p) => p.requestId === d.requestId) : undefined} />)
        )}
      </section>

      <section className="section">
        <div className="section-title">
          <h2>How it works</h2>
          <p>Three systems, one job each</p>
        </div>
        <ol className="how">
          <li>
            <b>Atlas does real work</b>
            <span>Teams hire it on the Sokosumi marketplace and other AI agents pay it per report. It checks a Cardano wallet before you send money to it.</span>
          </li>
          <li>
            <b>Chainlink checks before paying</b>
            <span>A Chainlink workflow confirms the money is going to the investor contract, that Atlas is rated well, and asks two AI auditors. Only then may the buyer pay.</span>
          </li>
          <li>
            <b>Cardano pays investors first</b>
            <span>Every payment lands in a contract that can only release money by paying each investor their share and Atlas the rest.</span>
          </li>
        </ol>
      </section>

      <footer className="foot">
        <span>
          Investor contract{" "}
          <a className="mono" href={cardanoscan.address(SPLITTER)}>
            {short(SPLITTER)}
          </a>{" "}
          · Ratings and decisions{" "}
          <a className="mono" href={basescan.address(REGISTRY)}>
            {short(REGISTRY)}
          </a>
        </span>
        <span>Data refreshes every 20 seconds from the chains.</span>
      </footer>
    </main>
  );
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

function AgentCard({ rating, cardano }: { rating: Settled<Rating | null>; cardano: Settled<CardanoActivity> }) {
  const r = rating.ok ? rating.value : null;
  const parts = r ? scoreParts(BigInt(r.earnings), r.paymentCount, r.probeOk, r.latencyMs) : [];
  return (
    <section className="section">
      <div className="card agent">
        <div className="avatar">A</div>
        <div>
          <h2>Atlas</h2>
          <p className="promise">Check any Cardano wallet before you pay it.</p>
          <div className="badges">
            <span className="badge wait" title={`Sokosumi Coworker ${COWORKER_ID}`}>
              <i className="dot" /> Sokosumi Coworker · awaiting event approval
            </span>
            <span className="badge wait">
              <i className="dot" /> Masumi registry · pending
            </span>
            {r && (
              <a className="badge ok" href={r.txHash ? basescan.tx(r.txHash) : basescan.address(REGISTRY)}>
                <i className="dot" /> Rating verified by Chainlink
              </a>
            )}
          </div>
        </div>
        <div className="dial">
          {rating.ok ? (
            r ? (
              <>
                <div className="score">{r.score}</div>
                <div className="of">out of 1000</div>
                <div className="meter">
                  <span style={{ width: `${r.score / 10}%` }} />
                </div>
                <div className="of">updated {ago(r.observedAt)}</div>
              </>
            ) : (
              <div className="of">Not rated yet</div>
            )
          ) : (
            <div className="of">Rating unavailable</div>
          )}
        </div>
      </div>

      <div className="grid three" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>Paid by other agents</h3>
          <div className="big">
            {cardano.ok ? tusdm(cardano.value.earnedX402) : "–"}
            <small>tUSDM</small>
          </div>
          <p className="note">Per-report payments over x402</p>
        </div>
        <div className="card">
          <h3>Hired on Sokosumi</h3>
          <div className="big">
            {cardano.ok ? tusdm(cardano.value.earnedMasumi) : "–"}
            <small>tUSDM</small>
          </div>
          <p className="note">Tasks paid through Masumi escrow</p>
        </div>
        <div className="card">
          <h3>How the score is built</h3>
          {r ? (
            <ul className="breakdown">
              {parts.map((p) => (
                <li key={p.label}>
                  <span>{p.label}</span>
                  <b>{p.points}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="note">Appears after the first Chainlink rating.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function Deal({ cardano, investorName, bps }: { cardano: CardanoActivity; investorName: string; bps: number }) {
  const repaid = BigInt(cardano.repaidToInvestor);
  const toAtlas = cardano.splits.reduce((s, x) => s + BigInt(x.atlas), 0n);
  const locked = BigInt(cardano.lockedNow);
  const total = repaid + toAtlas + locked;
  const pct = (x: bigint) => (total === 0n ? 0 : Number((x * 10000n) / total) / 100);
  const lastSplit = cardano.splits[0];
  return (
    <div className="grid two">
      <div className="card">
        <h3>{investorName} gets {bps / 100}% of everything Atlas earns</h3>
        <div className="big">
          {tusdm(repaid)}
          <small>tUSDM repaid so far</small>
        </div>
        <div className="splitbar" aria-label="Where Atlas's earnings went">
          <span style={{ width: `${pct(repaid)}%`, background: "var(--accent)" }} />
          <span style={{ width: `${pct(toAtlas)}%`, background: "var(--ink)" }} />
          <span style={{ width: `${pct(locked)}%`, background: "var(--review)" }} />
        </div>
        <div className="legend">
          <span>
            <i style={{ background: "var(--accent)" }} />
            Investor {tusdm(repaid)}
          </span>
          <span>
            <i style={{ background: "var(--ink)" }} />
            Atlas {tusdm(toAtlas)}
          </span>
          <span>
            <i style={{ background: "var(--review)" }} />
            Waiting to be split {tusdm(locked)}
          </span>
        </div>
      </div>
      <div className="card">
        <h3>Last split</h3>
        {lastSplit ? (
          <>
            <div className="big">
              {lastSplit.coins} <small>payment{lastSplit.coins === 1 ? "" : "s"} split in one transaction</small>
            </div>
            <p className="note">
              Investor received {tusdm(lastSplit.investor)} tUSDM, Atlas {tusdm(lastSplit.atlas)} tUSDM, {ago(lastSplit.time)}.{" "}
              <a className="mono" href={cardanoscan.tx(lastSplit.txHash)}>
                {short(lastSplit.txHash)}
              </a>
            </p>
          </>
        ) : (
          <p className="note">No split yet. Anyone can trigger one; the contract decides who gets what.</p>
        )}
      </div>
    </div>
  );
}

function PaymentRow({ decision, payment }: { decision: Decision; payment?: Payment }) {
  const d = decision;
  const allowed = d.verdict === "ALLOW";
  const headline =
    d.verdict === "ALLOW"
      ? payment
        ? `Paid ${tusdm(payment.amount)} tUSDM for a wallet report`
        : "Approved, waiting for the buyer to pay"
      : d.verdict === "DENY"
        ? "Blocked by Chainlink. No money moved."
        : "Held for review. No money moved.";
  const step = (cls: string, title: string, body: React.ReactNode) => (
    <li className={`step ${cls}`}>
      <div>
        <b>{title}</b>
        <span>{body}</span>
      </div>
    </li>
  );
  return (
    <article className="payment">
      <header>
        <strong>
          <span className={`pill ${d.verdict}`}>{d.verdict}</span> {headline}
        </strong>
        <span className="when">
          {ago(d.decidedAt)} · request <span className="mono">{short(d.requestId)}</span>
        </span>
      </header>
      <ol className="steps">
        {step(
          allowed ? "done" : d.verdict === "DENY" ? "blocked" : "held",
          "Chainlink checked",
          <>
            rating {d.ratingUsed} ·{" "}
            <a href={basescan.tx(d.txHash)}>{short(d.txHash)}</a>
          </>,
        )}
        {step(allowed ? "done" : d.verdict === "DENY" ? "blocked" : "held", allowed ? "Allowed" : d.verdict === "DENY" ? "Blocked" : "Held", allowed ? "all checks passed" : "buyer kept its money")}
        {step(
          payment ? "done" : "",
          "Customer agent paid",
          payment ? <a href={cardanoscan.tx(payment.txHash)}>{short(payment.txHash)}</a> : allowed ? "waiting" : "not paid",
        )}
        {step(payment ? "done" : "", "Locked in investor contract", payment ? "receipt carries this request id" : "–")}
        {step(
          payment?.splitTx ? "done" : "",
          "Split to investor and Atlas",
          payment?.splitTx ? <a href={cardanoscan.tx(payment.splitTx)}>{short(payment.splitTx)}</a> : payment ? "waiting for the next split" : "–",
        )}
      </ol>
      {!allowed && flagWords(d.riskFlags).length > 0 && (
        <div className="callout">
          {flagWords(d.riskFlags).map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}
    </article>
  );
}
