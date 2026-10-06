import { ATLAS_DEAL, basescan, cardanoscan } from "@agentfund/shared";
import { COWORKER_ID, REGISTRY, SPLITTER, readCardano, readDecisions, readRating, type Decision, type Payment } from "../lib/chain";
import { readCoworkerTasks, type CoworkerTask } from "../lib/sokosumi";
import { ago, flagWords, scoreParts, short, tusdm } from "../lib/present";
import { Flow } from "./ui/Flow";
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

const grade = (s: number) => (s >= 800 ? "Strong" : s >= 600 ? "Solid" : s >= 300 ? "Building a record" : "Unproven");

export default async function Home() {
  const renderedAt = Date.now();
  const [rating, decisions, cardano, tasks] = await Promise.all([settle(readRating()), settle(readDecisions()), settle(readCardano()), readCoworkerTasks()]);

  const investor = ATLAS_DEAL.investors[0]!;
  const c = cardano.ok ? cardano.value : null;
  const ds = decisions.ok ? decisions.value : [];
  const r = rating.ok ? rating.value : null;
  const toAtlas = c ? c.splits.reduce((s, x) => s + BigInt(x.atlas), 0n) : 0n;
  const earned = c ? BigInt(c.earnedX402) + BigInt(c.earnedMasumi) : 0n;
  const count = (v: Decision["verdict"]) => ds.filter((d) => d.verdict === v).length;
  const blocked = count("DENY");

  return (
    <>
      <header className="topbar">
        <div className="shell" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", paddingBottom: 0 }}>
          <div className="brand">
            <span className="glyph">A</span> AgentFund
          </div>
          <nav>
            <a href="#flow">Money flow</a>
            <a href="#payments">Payments</a>
            <a href="#tasks">Tasks</a>
            <a href="#how">How it works</a>
          </nav>
          <Live renderedAt={renderedAt} />
        </div>
      </header>

      <main className="shell">
        <section className="hero">
          <div>
            <h1>
              Investors get paid <b>before</b> the agent does.
            </h1>
            <p>
              Atlas is an AI agent that checks Cardano wallets for a fee. Its investor put up money for a {investor.bps / 100}% share of everything it earns.
              Every payment lands in a contract that can only release money by paying the investor first, and Chainlink checks each payment before it is made.
            </p>
          </div>
          <div className="hero-aside">
            <div className="verdict-tally">
              <div className="tally allow">
                <div className="n num">{count("ALLOW")}</div>
                <div className="l">Allowed</div>
              </div>
              <div className="tally deny">
                <div className="n num">{blocked}</div>
                <div className="l">Blocked</div>
              </div>
              <div className="tally review">
                <div className="n num">{count("REVIEW")}</div>
                <div className="l">Held</div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-3)", textAlign: "center" }}>
              Chainlink decisions, recorded on Base Sepolia
            </div>
          </div>
        </section>

        <section className="stats">
          <div className="stat accent">
            <div className="k">Earned by Atlas</div>
            <div className="v num">
              {c ? tusdm(earned) : "–"}
              <small>tUSDM</small>
            </div>
            <div className="s">{c ? `${c.payments.length} payments into the contract` : "unavailable"}</div>
          </div>
          <div className="stat">
            <div className="k">Repaid to the investor</div>
            <div className="v num">
              {c ? tusdm(c.repaidToInvestor) : "–"}
              <small>tUSDM</small>
            </div>
            <div className="s">{c && c.splits.length > 0 ? `across ${c.splits.length} on-chain split${c.splits.length === 1 ? "" : "s"}` : "no split yet"}</div>
          </div>
          <div className="stat">
            <div className="k">Chainlink rating</div>
            <div className="v num">
              {r ? r.score : "–"}
              <small>/ 1000</small>
            </div>
            <div className="s">{r ? `${grade(r.score)} · ${ago(r.observedAt)}` : "not rated yet"}</div>
          </div>
          <div className="stat">
            <div className="k">Bad payments stopped</div>
            <div className="v num" style={{ color: blocked > 0 ? "var(--red)" : undefined }}>
              {blocked}
            </div>
            <div className="s">before any money moved</div>
          </div>
        </section>

        <section className="sec" id="flow">
          <div className="sec-head">
            <h2>Where the money goes</h2>
            <p>Read from the investor contract on Cardano preprod</p>
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
            <div className="panel err">Could not read Cardano{cardano.ok ? "" : `: ${cardano.error}`}</div>
          )}
        </section>

        <section className="sec">
          <div className="cols">
            <div className="panel panel-pad">
              <div className="agent-head">
                <div className="mark">A</div>
                <div>
                  <h3>Atlas</h3>
                  <p>Checks any Cardano wallet before you pay it, and explains the verdict in plain words with links to the public record.</p>
                  <div className="tags">
                    <span className="tag">Sokosumi · awaiting event approval</span>
                    <span className="tag">Masumi registry · registers once hosted</span>
                    {r && <span className="tag ok">Rating verified by Chainlink</span>}
                  </div>
                </div>
              </div>

              {r ? (
                <>
                  <div className="rating">
                    <div>
                      <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-0.035em", lineHeight: 1 }} className="num">
                        {r.score}
                        <span style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500, marginLeft: 5 }}>/ 1000</span>
                      </div>
                      <div className="meta">
                        {grade(r.score)} · updated {ago(r.observedAt)}
                      </div>
                      {r.txHash && (
                        <a href={basescan.tx(r.txHash)} target="_blank" rel="noreferrer">
                          View the rating on Base Sepolia →
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="bars">
                    {scoreParts(BigInt(r.earnings), r.paymentCount, r.probeOk, r.latencyMs).map((p) => {
                      const max = p.label.startsWith("Money") ? 400 : p.label.startsWith("Payments") ? 300 : p.label.startsWith("Service") ? 200 : 100;
                      return (
                        <div className="bar-row" key={p.label}>
                          <span>{p.label.replace(/ \(.*\)/, "")}</span>
                          <span className="track">
                            <i style={{ width: `${(p.points / max) * 100}%` }} />
                          </span>
                          <span className="pts">{p.points}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p style={{ color: "var(--text-3)", fontSize: 13 }}>{rating.ok ? "Not rated yet." : `Rating unavailable: ${rating.error}`}</p>
              )}
            </div>

            <div className="panel panel-pad">
              <div className="agent-head" style={{ borderBottom: "none", paddingBottom: 4 }}>
                <div>
                  <h3>The deal</h3>
                  <p>Written into the contract address, so it cannot be changed after funding.</p>
                </div>
              </div>
              <div className="deal-split">
                <i style={{ width: `${investor.bps / 100}%`, background: "var(--gold)" }} />
                <i style={{ width: `${100 - investor.bps / 100}%`, background: "var(--teal)" }} />
              </div>
              <dl className="kv">
                <dt>{investor.name} receives</dt>
                <dd className="num">{investor.bps / 100}% of every payment</dd>
                <dt>Atlas keeps</dt>
                <dd className="num">{100 - investor.bps / 100}%</dd>
                <dt>Repaid so far</dt>
                <dd className="num">{c ? tusdm(c.repaidToInvestor) : "–"} tUSDM</dd>
                <dt>Paid to Atlas</dt>
                <dd className="num">{tusdm(toAtlas)} tUSDM</dd>
                <dt>Awaiting the next split</dt>
                <dd className="num">{c ? tusdm(c.lockedNow) : "–"} tUSDM</dd>
                <dt>Price per report</dt>
                <dd>0.50 tUSDM</dd>
                <dt>Price per Sokosumi task</dt>
                <dd>1 tUSDM</dd>
                <dt>Coworker ID</dt>
                <dd className="mono">{short(COWORKER_ID)}</dd>
              </dl>
              <p style={{ fontSize: 12, color: "var(--text-3)", margin: "14px 0 0" }}>
                Anyone can trigger a split; the contract decides who gets what, so neither side has to trust the other.
              </p>
            </div>
          </div>
        </section>

        <section className="sec" id="payments">
          <div className="sec-head">
            <h2>Payments by AI agents</h2>
            <p>Each one checked by Chainlink before any money moves</p>
          </div>
          <div className="panel" style={{ overflow: "hidden" }}>
            {!decisions.ok ? (
              <div className="err">Could not read Chainlink decisions: {decisions.error}</div>
            ) : ds.length === 0 ? (
              <div className="empty">No agent has asked to pay Atlas yet.</div>
            ) : (
              <AgentTable decisions={ds} payments={c?.payments ?? []} />
            )}
          </div>
        </section>

        <section className="sec" id="tasks">
          <div className="sec-head">
            <h2>Tasks from Sokosumi teams</h2>
            <p>Paid through Masumi escrow</p>
          </div>
          <div className="panel" style={{ overflow: "hidden" }}>
            <TaskTable tasks={tasks} />
          </div>
        </section>

        <section className="sec" id="how">
          <div className="sec-head">
            <h2>How it works</h2>
            <p>Three systems, one job each</p>
          </div>
          <div className="steps3">
            <div>
              <div className="n">1</div>
              <b>Atlas does real work</b>
              <span>Teams hire it on the Sokosumi marketplace and other AI agents pay it per report. It checks a Cardano wallet before you send money to it.</span>
            </div>
            <div>
              <div className="n">2</div>
              <b>Chainlink checks before paying</b>
              <span>
                A workflow running on many independent computers confirms the money goes to the investor contract, that Atlas is rated well, and that two AI
                auditors agree. Only then may the buyer pay.
              </span>
            </div>
            <div>
              <div className="n">3</div>
              <b>Cardano pays investors first</b>
              <span>The contract can only release money by paying each investor their share and Atlas the rest. The agent never holds the money first.</span>
            </div>
          </div>
        </section>

        <footer className="foot">
          <div>
            <h4>On Cardano preprod</h4>
            <p>
              Investor contract{" "}
              <a className="mono" href={cardanoscan.address(SPLITTER)} target="_blank" rel="noreferrer">
                {short(SPLITTER)}
              </a>
            </p>
            <p>Splits are enforced by the contract itself.</p>
          </div>
          <div>
            <h4>On Base Sepolia</h4>
            <p>
              Ratings and payment checks{" "}
              <a className="mono" href={basescan.address(REGISTRY)} target="_blank" rel="noreferrer">
                {short(REGISTRY)}
              </a>
            </p>
            <p>Written by Chainlink CRE workflows.</p>
          </div>
          <div>
            <h4>About this page</h4>
            <p>Every figure is read live from public blockchains and refreshes every 20 seconds.</p>
            <p>Test networks and test money only.</p>
          </div>
        </footer>
      </main>
    </>
  );
}

function Tick({ state, children }: { state: "done" | "wait" | "none"; children: React.ReactNode }) {
  return (
    <span className={`step ${state}`}>
      <span className="tick">{state === "done" ? "✓" : state === "wait" ? "•" : "–"}</span>
      {children}
    </span>
  );
}

function AgentTable({ decisions, payments }: { decisions: Decision[]; payments: Payment[] }) {
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th style={{ width: "34%" }}>Request</th>
          <th>Chainlink check</th>
          <th>Paid on Cardano</th>
          <th>Split to investor</th>
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
                  {d.verdict === "ALLOW" ? (p ? `Wallet report · ${tusdm(p.amount)} tUSDM` : "Approved · payment pending") : d.verdict === "DENY" ? "Payment blocked" : "Payment held for review"}
                  <small>
                    {ago(d.decidedAt)} · receipt <span className="mono">{short(d.requestId)}</span>
                  </small>
                </div>
                {d.verdict !== "ALLOW" && words.length > 0 && (
                  <div className={`reason ${d.verdict === "REVIEW" ? "held" : ""}`}>
                    {words.join(" ")} {d.verdict === "DENY" ? "No money moved." : "The buyer kept its money."}
                  </div>
                )}
              </td>
              <td data-l="Chainlink check">
                <span className={`badge ${d.verdict}`}>{d.verdict === "ALLOW" ? "allowed" : d.verdict === "DENY" ? "blocked" : "held"}</span>
                <div style={{ marginTop: 5, fontSize: 12, color: "var(--text-3)" }}>
                  rating {d.ratingUsed} ·{" "}
                  <a className="mono hashlink" href={basescan.tx(d.txHash)} target="_blank" rel="noreferrer">
                    {short(d.txHash)}
                  </a>
                </div>
              </td>
              <td data-l="Paid on Cardano">
                {p ? (
                  <>
                    <Tick state="done">Into the contract</Tick>
                    <div style={{ marginTop: 4 }}>
                      <a className="mono hashlink" href={cardanoscan.tx(p.txHash)} target="_blank" rel="noreferrer">
                        {short(p.txHash)}
                      </a>
                    </div>
                  </>
                ) : (
                  <Tick state={d.verdict === "ALLOW" ? "wait" : "none"}>{d.verdict === "ALLOW" ? "Waiting for the buyer" : "Never paid"}</Tick>
                )}
              </td>
              <td data-l="Split to investor">
                {p?.splitTx ? (
                  <>
                    <Tick state="done">Investor and Atlas paid</Tick>
                    <div style={{ marginTop: 4 }}>
                      <a className="mono hashlink" href={cardanoscan.tx(p.splitTx)} target="_blank" rel="noreferrer">
                        {short(p.splitTx)}
                      </a>
                    </div>
                  </>
                ) : (
                  <Tick state={p ? "wait" : "none"}>{p ? "In the next split" : "—"}</Tick>
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
  failed: "Needs attention",
};

function TaskTable({ tasks }: { tasks: CoworkerTask[] | null }) {
  if (tasks === null) return <div className="empty">The Sokosumi worker is not reachable from this page right now.</div>;
  if (tasks.length === 0) return <div className="empty">No Sokosumi tasks yet.</div>;
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
                {STAGE[t.stage] ?? t.stage}
                <small>
                  {ago(Date.parse(t.startedAt) / 1000)} · task <span className="mono">{short(t.taskId)}</span>
                </small>
              </div>
            </td>
            <td data-l="Payment">
              {t.paid ? (
                <Tick state={t.onChainState ? "done" : "wait"}>{t.onChainState ? `Escrow: ${t.onChainState}` : "Requested"}</Tick>
              ) : (
                <Tick state="none">Free trial run</Tick>
              )}
            </td>
            <td data-l="Result">
              {t.resultHash ? (
                <>
                  <Tick state="done">{t.delivered === false ? "Guidance sent" : "Report delivered"}</Tick>
                  <div style={{ marginTop: 4 }} className="mono hashlink">
                    {short(t.resultHash)}
                  </div>
                </>
              ) : (
                <Tick state="wait">In progress</Tick>
              )}
            </td>
            <td data-l="Collected">
              {t.collectionTx ? (
                <>
                  <Tick state="done">{t.collectedAtomicUnits ? `${tusdm(t.collectedAtomicUnits)} tUSDM` : "Collected"}</Tick>
                  <div style={{ marginTop: 4 }}>
                    <a className="mono hashlink" href={cardanoscan.tx(t.collectionTx)} target="_blank" rel="noreferrer">
                      {short(t.collectionTx)}
                    </a>
                  </div>
                </>
              ) : (
                <Tick state={t.paid ? "wait" : "none"}>{t.paid ? "After the dispute window" : "—"}</Tick>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
