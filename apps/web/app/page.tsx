import { ATLAS_DEAL, basescan, cardanoscan } from "@agentfund/shared";
import {
  COWORKER_ID,
  REGISTRY,
  SPLITTER,
  readCardano,
  readDecisions,
  readRating,
  readTaskRepayments,
  type Decision,
  type Payment,
} from "../lib/chain";
import { TaskRepayments } from "./ui/TaskRepayments";
import { FundingJourney } from "./ui/FundingJourney";
import { FundAgent } from "./ui/FundAgent";
import { FundingRound } from "./ui/FundingRound";
import { Views } from "./ui/Views";
import {
  readAgentIdentity,
  readCoworkerTasks,
  readReliability,
  type AgentIdentity,
  type CoworkerTask,
} from "../lib/sokosumi";
import {
  ago,
  countdown,
  flagWords,
  scoreParts,
  short,
  tusdm,
} from "../lib/present";
import { Actions } from "./ui/Actions";
import { CheckWallet } from "./ui/CheckWallet";
import { Flow } from "./ui/Flow";
import { Live } from "./ui/Live";

export const revalidate = 20;

const SOKOSUMI_URL =
  process.env.SOKOSUMI_LISTING_URL ?? "https://preprod.sokosumi.com";
const VIDEO_URL = process.env.DEMO_VIDEO_URL;
const DEMO_SUBJECT =
  process.env.DEMO_SUBJECT ??
  "addr_test1wzs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgn37w4g";

type Settled<T> = { ok: true; value: T } | { ok: false; error: string };
async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await p };
  } catch (err) {
    return { ok: false, error: (err as Error).message.split("\n")[0]! };
  }
}

export default async function Home() {
  const renderedAt = Date.now();
  const [rating, decisions, cardano, tasks, identity, reliability] =
    await Promise.all([
      settle(readRating()),
      settle(readDecisions()),
      settle(readCardano()),
      readCoworkerTasks(),
      readAgentIdentity(),
      readReliability(),
    ]);

  const investor = ATLAS_DEAL.investors[0]!;
  const pct = investor.bps / 100;
  const c = cardano.ok ? cardano.value : null;
  const repayments = await readTaskRepayments(tasks, c);
  const ds = decisions.ok ? decisions.value : [];
  const r = rating.ok ? rating.value : null;
  const toAtlas = c ? c.splits.reduce((s, x) => s + BigInt(x.atlas), 0n) : 0n;
  const count = (v: Decision["verdict"]) =>
    ds.filter((d) => d.verdict === v).length;
  const reports = ds.filter(
    (d) =>
      d.verdict === "ALLOW" &&
      c?.payments.some((p) => p.requestId === d.requestId),
  ).length;
  const sokosumiDone = (tasks ?? []).filter((t) =>
    ["completed", "awaiting-withdrawal", "settled"].includes(t.stage),
  ).length;

  return (
    <>
      <header className="topbar">
        <div className="shell bar">
          <div className="brand">
            <span className="glyph">A</span> AgentFund
          </div>
          <Live renderedAt={renderedAt} />
        </div>
      </header>

      <main className="shell">
        <section className="hero">
          <div>
            <h1>
              AI agents that earn can now <b>raise money</b>, and repay it
              automatically.
            </h1>
            <p className="sub">
              Atlas is an AI agent that checks who you are about to pay on
              Cardano &mdash; a person, a contract, or another AI agent. It
              charges for each check. Direct agent payments enter a Cardano
              contract that pays the backer first; Sokosumi earnings depend on
              an operator-wallet sweep.
            </p>
            <div className="hero-cta">
              <a className="btn primary" href="#check">
                Check a wallet
              </a>
              <a
                className="btn"
                href={SOKOSUMI_URL}
                target="_blank"
                rel="noreferrer"
              >
                Hire Atlas on Sokosumi ↗
              </a>
            </div>
          </div>
          <ol className="strip">
            <li>
              <span className="n">1</span>
              <div>
                <b>Hired</b>
                <span>
                  Teams hire Atlas on Sokosumi. Agents pay it per report.
                </span>
              </div>
            </li>
            <li>
              <span className="n">2</span>
              <div>
                <b>Checked by Chainlink</b>
                <span>
                  Our buyer checks with Chainlink before making an agent
                  payment.
                </span>
              </div>
            </li>
            <li>
              <span className="n">3</span>
              <div>
                <b>Split on Cardano</b>
                <span>
                  The contract pays the backer first. Atlas cannot skip it.
                </span>
              </div>
            </li>
          </ol>
        </section>

        <section className="stats">
          <Stat
            k="Payments made"
            v={String(c?.payments.length ?? "–")}
            s="into the investor contract"
          />
          <Stat
            k="Splits enforced on-chain"
            v={String(c?.splits.length ?? "–")}
            s="backer paid first, every time"
            accent
          />
          <Stat
            k="Bad payments blocked"
            v={String(count("DENY"))}
            s="before any money moved"
            danger={count("DENY") > 0}
          />
          <Stat
            k="Reports delivered"
            v={String(reports + sokosumiDone)}
            s={`${reports} to agents · ${sokosumiDone} on Sokosumi`}
          />
        </section>

        <Views
          views={[
            {
              id: "check",
              label: "Check a wallet",
              hint: "What Atlas does, free to try",
              content: (
                <>
                  <section className="sec" id="check">
                    <div className="sec-head">
                      <h2>Who are you about to pay?</h2>
                      <p>Free preview of the report Atlas sells</p>
                    </div>
                    <CheckWallet sokosumiUrl={SOKOSUMI_URL} />
                  </section>
                </>
              ),
            },
            {
              id: "repay",
              label: "Fund an agent",
              hint: "Choose terms, fund and track repayment",
              content: (
                <>
                  <FundAgent />
                  <section className="sec" id="flow">
                    <div className="sec-head">
                      <h2>Where the money goes</h2>
                      <p>Read from the investor contract</p>
                    </div>
                    {c ? (
                      <Flow
                        fromAgents={BigInt(c.earnedX402)}
                        fromTeams={BigInt(c.earnedMasumi)}
                        toInvestor={BigInt(c.repaidToInvestor)}
                        toAtlas={toAtlas}
                        waiting={BigInt(c.lockedNow)}
                        investorName="Seed backer"
                        investorPct={pct}
                      />
                    ) : (
                      <div className="panel err">
                        Could not read Cardano
                        {cardano.ok ? "" : `: ${cardano.error}`}
                      </div>
                    )}
                  </section>
                  <section className="sec">
                    <div className="cols">
                      <div className="panel panel-pad">
                        <h3 className="card-title">Atlas</h3>
                        <p className="card-sub">
                          Shows Cardano address history and registry claims.
                          Registration does not certify trustworthiness;
                          fraud-detection accuracy remains unvalidated.
                        </p>
                        <Badges identity={identity} rated={Boolean(r)} />
                        {r ? (
                          <>
                            <div className="rating">
                              <div className="score num">
                                {r.score}
                                <span>/ 1000</span>
                              </div>
                              <div className="meta">
                                New agent, still building a record. The score
                                rises with real earnings and uptime.
                              </div>
                              {r.txHash && (
                                <a
                                  href={basescan.tx(r.txHash)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Rating written by Chainlink ↗
                                </a>
                              )}
                            </div>
                            <div className="bars">
                              {scoreParts(
                                BigInt(r.earnings),
                                r.paymentCount,
                                r.probeOk,
                                r.latencyMs,
                              ).map((p) => {
                                const max = p.label.startsWith("Money")
                                  ? 400
                                  : p.label.startsWith("Payments")
                                    ? 300
                                    : p.label.startsWith("Service")
                                      ? 200
                                      : 100;
                                return (
                                  <div className="bar-row" key={p.label}>
                                    <span>
                                      {p.label.replace(/ \(.*\)/, "")}
                                    </span>
                                    <span className="track">
                                      <i
                                        style={{
                                          width: `${(p.points / max) * 100}%`,
                                        }}
                                      />
                                    </span>
                                    <span className="pts">{p.points}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        ) : (
                          <p className="muted small">
                            {rating.ok
                              ? "Not rated yet."
                              : `Rating unavailable: ${rating.error}`}
                          </p>
                        )}
                      </div>

                      <div className="panel panel-pad">
                        <h3 className="card-title">The deal</h3>
                        <p className="card-sub">
                          Written into the contract address, so it cannot be
                          changed after funding.
                        </p>
                        <div className="deal-split">
                          <i
                            style={{
                              width: `${pct}%`,
                              background: "var(--gold)",
                            }}
                          />
                          <i
                            style={{
                              width: `${100 - pct}%`,
                              background: "var(--teal)",
                            }}
                          />
                        </div>
                        <dl className="kv">
                          <dt>Seed backer (test wallet)</dt>
                          <dd className="num">{pct}% of every payment</dd>
                          <dt>Atlas keeps</dt>
                          <dd className="num">{100 - pct}%</dd>
                          <dt>Repaid so far</dt>
                          <dd className="num">
                            {c ? tusdm(c.repaidToInvestor) : "–"} tUSDM
                          </dd>
                          <dt>Awaiting the next split</dt>
                          <dd className="num">
                            {c ? tusdm(c.lockedNow) : "–"} tUSDM
                          </dd>
                          <dt>Price</dt>
                          <dd>
                            0.50 tUSDM per report · 1 tUSDM per Sokosumi task
                          </dd>
                          <dt>Coworker ID</dt>
                          <dd className="mono">{short(COWORKER_ID)}</dd>
                        </dl>
                        <p className="muted small">
                          Atlas demonstrates one fixed seed deal. Additional
                          agents and investors require a separate deal.
                        </p>
                        <FundingJourney activity={c} />
                      </div>
                    </div>
                    <FundingRound />
                  </section>
                  <section className="sec" id="tasks">
                    <div className="sec-head">
                      <h2>Tasks from Sokosumi teams</h2>
                      <p>Paid through Masumi escrow</p>
                    </div>
                    {reliability && (
                      <p className="muted">
                        Observed paid Task attempts:{" "}
                        {reliability.paidCollectionsVerified} collected ·{" "}
                        {reliability.paidTasksFailed} failed ·{" "}
                        {reliability.paidTasksOngoing} ongoing. {reliability.paidTasksNeedingRecovery ? `${reliability.paidTasksNeedingRecovery} need worker recovery; no payment is being retried. ` : ""}Includes
                        historical failures; this sample does not establish
                        marketplace reliability.
                      </p>
                    )}
                    <TaskRepayments tasks={tasks} repayments={repayments} />
                    <div className="panel overflow">
                      <TaskTable tasks={tasks} now={renderedAt} />
                    </div>
                  </section>

                  <footer className="foot">
                    <div>
                      <h4>On Cardano preprod</h4>
                      <p>
                        Investor contract{" "}
                        <a
                          className="mono"
                          href={cardanoscan.address(SPLITTER)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {short(SPLITTER)} ↗
                        </a>
                      </p>
                    </div>
                    <div>
                      <h4>On Base Sepolia</h4>
                      <p>
                        Ratings and payment checks{" "}
                        <a
                          className="mono"
                          href={basescan.address(REGISTRY)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {short(REGISTRY)} ↗
                        </a>
                      </p>
                    </div>
                    <div>
                      <h4>About this page</h4>
                      <p>
                        Every figure is read live from public blockchains. Test
                        networks and test money only.
                      </p>
                    </div>
                  </footer>
                </>
              ),
            },
            {
              id: "proof",
              label: "Try it live",
              hint: "Run a real payment, or block one",
              content: (
                <>
                  <section className="sec" id="try">
                    <div className="sec-head">
                      <h2>Try it yourself</h2>
                      <p>Real transactions, on test networks, right now</p>
                    </div>
                    <Actions
                      enabled={process.env.DEMO_ACTIONS === "on"}
                      videoUrl={VIDEO_URL}
                      subject={DEMO_SUBJECT}
                    />
                  </section>
                  <section className="sec" id="payments">
                    <div className="sec-head">
                      <h2>Payments by AI agents</h2>
                      <p>
                        {count("ALLOW")} allowed · {count("DENY")} blocked ·{" "}
                        {count("REVIEW")} held
                      </p>
                    </div>
                    <div className="panel overflow">
                      {!decisions.ok ? (
                        <div className="err">
                          Could not read Chainlink decisions: {decisions.error}
                        </div>
                      ) : ds.length === 0 ? (
                        <div className="empty">
                          No agent has asked to pay Atlas yet.
                        </div>
                      ) : (
                        <>
                          <AgentTable
                            decisions={ds.slice(0, 5)}
                            payments={c?.payments ?? []}
                          />
                          {ds.length > 5 && (
                            <details className="payment-history">
                              <summary>
                                View {ds.length - 5} earlier payments
                              </summary>
                              <AgentTable
                                decisions={ds.slice(5)}
                                payments={c?.payments ?? []}
                              />
                            </details>
                          )}
                        </>
                      )}
                    </div>
                  </section>
                </>
              ),
            },
          ]}
        />
      </main>
    </>
  );
}

function Stat({
  k,
  v,
  s,
  accent,
  danger,
}: {
  k: string;
  v: string;
  s: string;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <div className={`stat${accent ? " accent" : ""}`}>
      <div className="k">{k}</div>
      <div
        className="v num"
        style={danger ? { color: "var(--red)" } : undefined}
      >
        {v}
      </div>
      <div className="s">{s}</div>
    </div>
  );
}

function Badges({
  identity,
  rated,
}: {
  identity: AgentIdentity | null;
  rated: boolean;
}) {
  const registered = identity?.masumi?.state === "RegistrationConfirmed";
  return (
    <div className="tags">
      <span className="tag ok">Live on Sokosumi</span>
      <span className={`tag ${registered ? "ok" : ""}`}>
        {registered ? "Registered on Masumi" : "Masumi registry · pending"}
      </span>
      {rated && <span className="tag ok">Rated by Chainlink</span>}
    </div>
  );
}

function Tick({
  state,
  children,
}: {
  state: "done" | "wait" | "none";
  children: React.ReactNode;
}) {
  return (
    <span className={`step ${state}`}>
      <span className="tick">
        {state === "done" ? "✓" : state === "wait" ? "•" : "–"}
      </span>
      {children}
    </span>
  );
}

function AgentTable({
  decisions,
  payments,
}: {
  decisions: Decision[];
  payments: Payment[];
}) {
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th style={{ width: "34%" }}>Request</th>
          <th>Chainlink check</th>
          <th>Paid on Cardano</th>
          <th>Split to backer</th>
        </tr>
      </thead>
      <tbody>
        {decisions.map((d) => {
          const p = payments.find((x) => x.requestId === d.requestId);
          const words = flagWords(d.riskFlags);
          return (
            <tr key={d.requestId}>
              <td data-l="Request">
                <div className="title-cell">
                  {d.verdict === "ALLOW"
                    ? p
                      ? `Wallet report · ${tusdm(p.amount)} tUSDM`
                      : "Approved · payment pending"
                    : d.verdict === "DENY"
                      ? "Payment blocked"
                      : "Payment held"}
                  <small>
                    {ago(d.decidedAt)} · receipt{" "}
                    <span className="mono">{short(d.requestId)}</span>
                  </small>
                </div>
                {d.verdict !== "ALLOW" && words.length > 0 && (
                  <div
                    className={`reason ${d.verdict === "REVIEW" ? "held" : ""}`}
                  >
                    {words.join(" ")}{" "}
                    {d.verdict === "DENY"
                      ? "No money moved."
                      : "The buyer kept its money."}
                  </div>
                )}
              </td>
              <td data-l="Chainlink check">
                <span className={`badge ${d.verdict}`}>
                  {d.verdict === "ALLOW"
                    ? "allowed"
                    : d.verdict === "DENY"
                      ? "blocked"
                      : "held"}
                </span>
                <div className="sub-line">
                  rating {d.ratingUsed} ·{" "}
                  <a
                    className="mono hashlink"
                    href={basescan.tx(d.txHash)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(d.txHash)} ↗
                  </a>
                </div>
              </td>
              <td data-l="Paid on Cardano">
                {p ? (
                  <>
                    <Tick state="done">Into the contract</Tick>
                    <div className="sub-line">
                      <a
                        className="mono hashlink"
                        href={cardanoscan.tx(p.txHash)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {short(p.txHash)} ↗
                      </a>
                    </div>
                  </>
                ) : (
                  <Tick state={d.verdict === "ALLOW" ? "wait" : "none"}>
                    {d.verdict === "ALLOW"
                      ? "Waiting for the buyer"
                      : "Never paid"}
                  </Tick>
                )}
              </td>
              <td data-l="Split to backer">
                {p?.splitTx ? (
                  <>
                    <Tick state="done">Backer and Atlas paid</Tick>
                    <div className="sub-line">
                      <a
                        className="mono hashlink"
                        href={cardanoscan.tx(p.splitTx)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {short(p.splitTx)} ↗
                      </a>
                    </div>
                  </>
                ) : (
                  <Tick state={p ? "wait" : "none"}>
                    {p ? "In the next split" : "—"}
                  </Tick>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const STAGE: Record<string, string> = {
  new: "Task received",
  terms: "Price agreed",
  "awaiting-escrow": "Waiting for payment into escrow",
  "result-saved": "Report written",
  "awaiting-result": "Fingerprint going on-chain",
  "complete-ready": "Delivering the report",
  completed: "Report delivered",
  "awaiting-withdrawal": "Delivered · dispute window open",
  settled: "Paid out",
  failed: "Failed",
  "needs-recovery": "Ongoing · needs recovery",
};

function TaskTable({
  tasks,
  now,
}: {
  tasks: CoworkerTask[] | null;
  now: number;
}) {
  if (tasks === null)
    return (
      <div className="empty">
        The Sokosumi worker is not reachable from this page right now.
      </div>
    );
  if (tasks.length === 0)
    return <div className="empty">No Sokosumi tasks yet.</div>;
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th style={{ width: "34%" }}>Task</th>
          <th>Payment</th>
          <th>Result</th>
          <th>Collected</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => (
          <tr key={t.taskId}>
            <td data-l="Task">
              <div className="title-cell">
                {STAGE[t.stage] ?? t.stage}{t.sourceStale ? " · last known progress (worker offline)" : ""}
                <small>
                  {ago(Date.parse(t.startedAt) / 1000)} · task{" "}
                  <span className="mono">{short(t.taskId)}</span>
                </small>
              </div>
            </td>
            <td data-l="Payment">
              {t.paid ? (
                <Tick state={t.onChainState ? "done" : "wait"}>
                  {t.onChainState ? `Escrow: ${t.onChainState}` : t.stage === "needs-recovery" ? "Awaiting verification" : "Requested"}
                </Tick>
              ) : (
                <Tick state="none">Free trial run</Tick>
              )}
            </td>
            <td data-l="Result">
              {t.resultHash ? (
                <>
                  <Tick state="done">
                    {t.delivered === false
                      ? "Guidance sent"
                      : "Report delivered"}
                  </Tick>
                  <div className="sub-line mono">{short(t.resultHash)}</div>
                </>
              ) : (
                <Tick state={t.stage === "failed" ? "none" : "wait"}>
                  {t.stage === "failed"
                    ? "Stopped; inspect task state"
                    : t.stage === "needs-recovery" ? "Worker recovery required" : "In progress"}
                </Tick>
              )}
            </td>
            <td data-l="Collected">
              {t.collectionTx ? (
                <>
                  <Tick state="done">
                    {t.collectedAtomicUnits
                      ? `${tusdm(t.collectedAtomicUnits)} tUSDM`
                      : "Collected"}
                  </Tick>
                  <div className="sub-line">
                    <a
                      className="mono hashlink"
                      href={cardanoscan.tx(t.collectionTx)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {short(t.collectionTx)} ↗
                    </a>
                  </div>
                </>
              ) : t.stage === "failed" ? (
                <Tick state="none">Not verified</Tick>
              ) : t.paid && t.unlockTime ? (
                <Tick state="wait">
                  Payout unlocks in {countdown(Number(t.unlockTime), now)}
                </Tick>
              ) : (
                <Tick state={t.paid ? "wait" : "none"}>
                  {t.paid ? "After the dispute window" : "—"}
                </Tick>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
