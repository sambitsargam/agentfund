import { ATLAS_DEAL, basescan, cardanoscan } from "@agentfund/shared";
import { COWORKER_ID, REGISTRY, SPLITTER, readCardano, readDecisions, readRating, type CardanoActivity, type Decision, type Payment } from "../lib/chain";
import { readCoworkerTasks, type CoworkerTask } from "../lib/sokosumi";
import { ago, flagWords, scoreParts, short, tusdm } from "../lib/present";
import { Flow } from "./ui/Flow";
import { Gauge, gradeOf } from "./ui/Gauge";
import { Live } from "./ui/Live";

export const revalidate = 20;

type Settled<T> = { ok: true; value: T } | { ok: false; error: string };
async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await p };
  } catch (err) {
    return { ok: false, error: (err as Error).message.split("\n")[0]! };
  }
}

const Term = ({ children, note }: { children: React.ReactNode; note: string }) => (
  <span className="term" tabIndex={0} data-note={note}>
    {children}
  </span>
);

const dateLine = (d: Date) =>
  d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Singapore" });

export default async function Home() {
  const renderedAt = Date.now();
  const [rating, decisions, cardano, tasks] = await Promise.all([
    settle(readRating()),
    settle(readDecisions()),
    settle(readCardano()),
    readCoworkerTasks(),
  ]);
  const investor = ATLAS_DEAL.investors[0]!;
  const c = cardano.ok ? cardano.value : null;
  const toAtlas = c ? c.splits.reduce((s, x) => s + BigInt(x.atlas), 0n) : 0n;
  const earned = c ? BigInt(c.earnedX402) + BigInt(c.earnedMasumi) : 0n;
  const ds = decisions.ok ? decisions.value : [];
  const count = (v: Decision["verdict"]) => ds.filter((d) => d.verdict === v).length;

  return (
    <main className="page">
      <header className="masthead">
        <div className="left">{dateLine(new Date(renderedAt))}</div>
        <div className="name">AgentFund</div>
        <div className="right">Statement for Atlas · test networks</div>
      </header>
      <div className="subhead">
        <span>Cardano preprod · Base Sepolia · Sokosumi preprod</span>
        <Live renderedAt={renderedAt} />
      </div>

      <section className="lead">
        <div>
          <h1>
            {c && earned > 0n ? (
              <>
                Atlas has earned <span className="fig">{tusdm(earned)} tUSDM</span> from {c.payments.length} payments, and{" "}
                <span className="fig">{tusdm(c.repaidToInvestor)} tUSDM</span> has already gone back to its investor without anyone sending it.
              </>
            ) : (
              <>Back an AI agent, and get paid from every payment it earns.</>
            )}
          </h1>
          <p className="standfirst">
            Investors fund an AI agent in return for a share of its future earnings. Every payment to the agent lands in an{" "}
            <Term note="A program on the Cardano blockchain that holds Atlas's income and can only release it by paying each investor their share first.">
              investor contract
            </Term>{" "}
            that pays investors first, so the agent cannot skip them. Before another agent pays, a{" "}
            <Term note="Chainlink CRE runs the same check on many independent computers and records the verdict on a public blockchain.">Chainlink check</Term>{" "}
            confirms the payment is going to the right place.
            {ds.length > 0 && (
              <>
                {" "}
                So far it has allowed {count("ALLOW")}, blocked {count("DENY")} and held {count("REVIEW")} payment requests.
              </>
            )}
          </p>
        </div>
        <aside>
          <h2>How a payment works</h2>
          <ol>
            <li>An AI agent asks Atlas for a wallet report, and Atlas quotes a price.</li>
            <li>Chainlink checks the money would go into the investor contract and that Atlas has a good record. Two AI auditors must agree.</li>
            <li>Only then does the agent pay. The payment carries the check&apos;s receipt number.</li>
            <li>The contract splits it: {investor.bps / 100}% to the investor, the rest to Atlas.</li>
          </ol>
        </aside>
      </section>

      <div className="kicker">
        <h2>The agent</h2>
        <div className="rule" />
        <p>What investors are backing</p>
      </div>
      <section className="agent">
        <div className="who">
          <h3>Atlas</h3>
          <p>Checks any Cardano wallet before you pay it, and explains the verdict in plain words with links to the public record.</p>
          <dl className="facts">
            <dt>Sokosumi</dt>
            <dd>
              <span className="status">Coworker, awaiting event approval</span>
            </dd>
            <dt>Coworker ID</dt>
            <dd className="mono">{short(COWORKER_ID)}</dd>
            <dt>Masumi registry</dt>
            <dd>
              <span className="status">registers once hosted</span>
            </dd>
            <dt>Price</dt>
            <dd>1 tUSDM per Sokosumi task · 0.50 tUSDM per agent report</dd>
          </dl>
        </div>
        <div>
          <p className="figure-label">Chainlink rating</p>
          {rating.ok && rating.value ? (
            <>
              <div className="gauge">
                <Gauge score={rating.value.score} />
                <div>
                  <div className="grade">{gradeOf(rating.value.score)}</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    out of 1000 · {ago(rating.value.observedAt)}
                  </div>
                  {rating.value.txHash && (
                    <a style={{ fontSize: 13 }} href={basescan.tx(rating.value.txHash)}>
                      verified on Base Sepolia
                    </a>
                  )}
                </div>
              </div>
              <ul className="parts">
                {scoreParts(BigInt(rating.value.earnings), rating.value.paymentCount, rating.value.probeOk, rating.value.latencyMs).map((p) => (
                  <li key={p.label}>
                    <span>{p.label}</span>
                    <b>{p.points}</b>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="figure-note">{rating.ok ? "Not rated yet." : `Rating unavailable: ${rating.error}`}</p>
          )}
        </div>
        <div>
          <p className="figure-label">Earned so far</p>
          <div className="figure">
            {c ? tusdm(earned) : "–"}
            <span className="unit">tUSDM</span>
          </div>
          <div className="split-figures">
            <div>
              <p className="figure-label">From AI agents</p>
              <div className="figure" style={{ fontSize: 26 }}>
                {c ? tusdm(c.earnedX402) : "–"}
              </div>
            </div>
            <div>
              <p className="figure-label">From Sokosumi</p>
              <div className="figure" style={{ fontSize: 26 }}>
                {c ? tusdm(c.earnedMasumi) : "–"}
              </div>
            </div>
          </div>
          <p className="figure-note">Counted from payments that reached the investor contract.</p>
        </div>
      </section>

      <div className="kicker">
        <h2>Where the money goes</h2>
        <div className="rule" />
        <p>Read from the investor contract</p>
      </div>
      {c ? (
        <Flow
          fromAgents={BigInt(c.earnedX402)}
          fromTeams={BigInt(c.earnedMasumi)}
          toInvestor={BigInt(c.repaidToInvestor)}
          toAtlas={toAtlas}
          waiting={BigInt(c.lockedNow)}
          investorName={investor.name}
          investorPct={investor.bps / 100}
        />
      ) : (
        <div className="error">Could not read Cardano: {cardano.ok ? "" : cardano.error}</div>
      )}

      <div className="kicker">
        <h2>Payments by AI agents</h2>
        <div className="rule" />
        <p>Newest first · each checked by Chainlink before money moves</p>
      </div>
      {!decisions.ok ? (
        <div className="error">Could not read Chainlink decisions: {decisions.error}</div>
      ) : ds.length === 0 ? (
        <div className="empty">No agent has asked to pay Atlas yet.</div>
      ) : (
        <AgentLedger decisions={ds} payments={c?.payments ?? []} />
      )}

      <div className="kicker">
        <h2>Tasks from Sokosumi teams</h2>
        <div className="rule" />
        <p>Paid through Masumi escrow</p>
      </div>
      <TaskLedger tasks={tasks} />

      <footer className="colophon">
        <div>
          <h4>On Cardano</h4>
          <p>
            Investor contract{" "}
            <a className="mono" href={cardanoscan.address(SPLITTER)}>
              {short(SPLITTER)}
            </a>
          </p>
          <p>Splits are enforced by the contract; anyone may trigger one.</p>
        </div>
        <div>
          <h4>On Base Sepolia</h4>
          <p>
            Ratings and payment checks{" "}
            <a className="mono" href={basescan.address(REGISTRY)}>
              {short(REGISTRY)}
            </a>
          </p>
          <p>Written by Chainlink CRE workflows.</p>
        </div>
        <div>
          <h4>About this page</h4>
          <p>Every figure is read from public blockchains, refreshed every 20 seconds. Test money only.</p>
        </div>
      </footer>
    </main>
  );
}

function AgentLedger({ decisions, payments }: { decisions: Decision[]; payments: Payment[] }) {
  return (
    <table className="ledger">
      <thead>
        <tr>
          <th style={{ width: "30%" }}>Request</th>
          <th>Chainlink check</th>
          <th>Paid on Cardano</th>
          <th>Split</th>
        </tr>
      </thead>
      <tbody>
        {decisions.map((d) => {
          const p = payments.find((x) => x.requestId === d.requestId);
          const words = flagWords(d.riskFlags);
          return (
            <tr key={d.requestId}>
              <td data-label="Request">
                <div className="what">
                  {d.verdict === "ALLOW" ? (p ? `Wallet report, ${tusdm(p.amount)} tUSDM` : "Approved, payment pending") : d.verdict === "DENY" ? "Payment blocked" : "Payment held"}
                  <small>
                    {ago(d.decidedAt)} · receipt <span className="mono">{short(d.requestId)}</span>
                  </small>
                </div>
                {d.verdict !== "ALLOW" && words.length > 0 && (
                  <div className={`why ${d.verdict === "REVIEW" ? "held" : ""}`}>
                    {words.join(" ")} {d.verdict === "DENY" ? "No money moved." : "The buyer kept its money."}
                  </div>
                )}
              </td>
              <td data-label="Chainlink check">
                <div className="cell-step">
                  <span>
                    <span className={`verdict ${d.verdict}`}>{d.verdict === "ALLOW" ? "allowed" : d.verdict === "DENY" ? "blocked" : "held"}</span>
                  </span>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    rating {d.ratingUsed} ·{" "}
                    <a className="mono" href={basescan.tx(d.txHash)}>
                      {short(d.txHash)}
                    </a>
                  </span>
                </div>
              </td>
              <td data-label="Paid on Cardano">
                {p ? (
                  <div className="cell-step">
                    <span className="mark done">✓ into the investor contract</span>
                    <a className="mono" href={cardanoscan.tx(p.txHash)}>
                      {short(p.txHash)}
                    </a>
                  </div>
                ) : (
                  <span className={`mark ${d.verdict === "ALLOW" ? "wait" : "no"}`}>{d.verdict === "ALLOW" ? "waiting for the buyer" : "not paid"}</span>
                )}
              </td>
              <td data-label="Split">
                {p?.splitTx ? (
                  <div className="cell-step">
                    <span className="mark done">✓ investor and Atlas paid</span>
                    <a className="mono" href={cardanoscan.tx(p.splitTx)}>
                      {short(p.splitTx)}
                    </a>
                  </div>
                ) : (
                  <span className={`mark ${p ? "wait" : "no"}`}>{p ? "in the next split" : "–"}</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const TASK_STAGE: Record<string, string> = {
  new: "Task received",
  terms: "Price agreed",
  "awaiting-escrow": "Waiting for payment into escrow",
  "result-saved": "Report written",
  "awaiting-result": "Result fingerprint going on-chain",
  "complete-ready": "Delivering the report",
  completed: "Report delivered",
  "awaiting-withdrawal": "Report delivered · dispute window open",
  settled: "Paid out",
  failed: "Needs attention",
};

function TaskLedger({ tasks }: { tasks: CoworkerTask[] | null }) {
  if (tasks === null) return <div className="empty">The Sokosumi worker is not reachable from this page right now.</div>;
  if (tasks.length === 0) return <div className="empty">No Sokosumi tasks yet.</div>;
  return (
    <table className="ledger">
      <thead>
        <tr>
          <th style={{ width: "30%" }}>Task</th>
          <th>Payment</th>
          <th>Result</th>
          <th>Collected</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => (
          <tr key={t.taskId}>
            <td data-label="Task">
              <div className="what">
                {TASK_STAGE[t.stage] ?? t.stage}
                <small>
                  {ago(Date.parse(t.startedAt) / 1000)} · task <span className="mono">{short(t.taskId)}</span>
                </small>
              </div>
            </td>
            <td data-label="Payment">
              {t.paid ? (
                <span className={`mark ${t.onChainState ? "done" : "wait"}`}>{t.onChainState ? `escrow: ${t.onChainState}` : "requested"}</span>
              ) : (
                <span className="mark no">free trial run</span>
              )}
            </td>
            <td data-label="Result">
              {t.resultHash ? (
                <div className="cell-step">
                  <span className="mark done">✓ {t.delivered === false ? "guidance sent" : "report delivered"}</span>
                  <span className="mono muted">{short(t.resultHash)}</span>
                </div>
              ) : (
                <span className="mark wait">in progress</span>
              )}
            </td>
            <td data-label="Collected">
              {t.collectionTx ? (
                <div className="cell-step">
                  <span className="mark done">✓ {t.collectedAtomicUnits ? `${tusdm(t.collectedAtomicUnits)} tUSDM` : "collected"}</span>
                  <a className="mono" href={cardanoscan.tx(t.collectionTx)}>
                    {short(t.collectionTx)}
                  </a>
                </div>
              ) : (
                <span className={`mark ${t.paid ? "wait" : "no"}`}>
                  {t.paid ? (t.unlockTime ? `after ${new Date(Number(t.unlockTime)).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "after the dispute window") : "–"}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
