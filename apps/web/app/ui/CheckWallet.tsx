"use client";

import { useState } from "react";
import type { Report } from "@agentfund/shared";

const CARDANOSCAN = "https://preprod.cardanoscan.io";

const PRESETS = [
  { label: "A busy contract", address: "addr_test1wzs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgn37w4g" },
  { label: "An established wallet", address: "addr_test1qrseuc9dfg2qdn7vkg35lxnpzjk4y67nemcmmkc2k5t2yk6ddv3uplh7wk4p468pte5fpxgckpmuu2jcuk5vr2qpgz2q7gyegt" },
  { label: "A brand-new wallet", address: "addr_test1qqwdk97gwef6ypkjcd9hhgpls8ela9fdvee2wvaxnkmjqdtj5pvye96gvjtm2jv70mtyqsczypsl8f2d3dgtlcmktk0sv74rjj" },
];

type Result = { ok: true; report: Report; cached: boolean } | { ok: false; message: string; hint?: string };

const short = (s: string) => `${s.slice(0, 12)}…${s.slice(-6)}`;

export function CheckWallet({ sokosumiUrl }: { sokosumiUrl: string }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function run(address: string) {
    if (busy || !address.trim()) return;
    setValue(address);
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      setResult((await res.json()) as Result);
    } catch {
      setResult({ ok: false, message: "Could not reach the checker.", hint: "Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel check">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(value);
        }}
      >
        <label className="check-label" htmlFor="addr">
          Paste a Cardano address, stake address or $handle
        </label>
        <div className="check-row">
          <input
            id="addr"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="addr_test1…"
            spellCheck={false}
            autoComplete="off"
          />
          <button type="submit" className="btn primary" disabled={busy || !value.trim()}>
            {busy ? <span className="spin" aria-hidden /> : null}
            {busy ? "Checking…" : "Check wallet"}
          </button>
        </div>
      </form>

      <div className="chips">
        <span className="chips-label">Try one:</span>
        {PRESETS.map((p) => (
          <button key={p.address} className="chip" onClick={() => void run(p.address)} disabled={busy}>
            {p.label}
          </button>
        ))}
      </div>

      {busy && <div className="check-skeleton" aria-hidden />}

      {result && !result.ok && (
        <div className="check-bad" role="status">
          <b>{result.message}</b>
          {result.hint && <span>{result.hint}</span>}
        </div>
      )}

      {result?.ok && <ReportView report={result.report} sokosumiUrl={sokosumiUrl} />}
    </div>
  );
}

const VERDICT: Record<string, { label: string; cls: string }> = {
  low: { label: "Low risk", cls: "low" },
  medium: { label: "Medium risk", cls: "medium" },
  high: { label: "High risk", cls: "high" },
  unknown: { label: "Unknown", cls: "unknown" },
};

function ReportView({ report, sokosumiUrl }: { report: Report; sokosumiUrl: string }) {
  const f = report.facts;
  const v = VERDICT[report.score.verdict] ?? VERDICT.unknown!;
  const cc = report.crossCheck;
  const txs = [...new Set(report.sources.flatMap((s) => s.txHashes ?? []))];

  const facts: [string, React.ReactNode][] = [];
  if (f.found) {
    facts.push(["First used", `${f.firstSeen?.slice(0, 10) ?? "unknown"}${f.ageDays !== null ? ` · ${f.ageDays} day${f.ageDays === 1 ? "" : "s"} ago` : ""}`]);
    facts.push(["Last active", f.lastSeen?.slice(0, 10) ?? "unknown"]);
    facts.push(["Transactions", `${f.txCount} total · ${f.txsLast30d}${f.txsLast30dCapped ? "+" : ""} in 30 days`]);
    facts.push(["Balance", `${f.balanceAda} ADA${f.tusdmBalance !== "0" ? ` · ${f.tusdmBalance} tUSDM` : ""}`]);
    facts.push(["Type", f.isScript ? "Smart contract" : "Regular wallet"]);
    facts.push(["Staking", f.delegatedPool ? "Delegated to a pool" : report.subject.stakeAddress ? "Has a staking key, not delegated" : "No staking key"]);
  } else {
    facts.push(["History", "No transactions have ever touched this address"]);
  }

  return (
    <div className="report">
      <div className="report-head">
        <span className={`verdict ${v.cls}`}>{v.label}</span>
        <p>{report.score.headline}</p>
      </div>
      <div className="report-sub">
        Checked{" "}
        <a className="mono" href={`${CARDANOSCAN}/address/${report.subject.address}`} target="_blank" rel="noreferrer">
          {report.subject.handle ?? short(report.subject.address)}
        </a>{" "}
        on Cardano preprod
      </div>

      <dl className="report-facts">
        {facts.map(([k, val]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{val}</dd>
          </div>
        ))}
      </dl>

      {report.score.redFlags.length > 0 && (
        <div className="report-block flags">
          <h4>What to watch</h4>
          <ul>
            {report.score.redFlags.map((flag) => (
              <li key={flag.code}>{flag.message}</li>
            ))}
          </ul>
        </div>
      )}

      {report.score.goodSigns.length > 0 && (
        <div className="report-block good">
          <h4>Good signs</h4>
          <ul>
            {report.score.goodSigns.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      )}

      <div className={`crosscheck ${cc.matches === true ? "ok" : cc.matches === false ? "bad" : ""}`}>
        {cc.matches === true
          ? "Verified against a second data source ✓"
          : cc.matches === false
            ? "Two data sources disagree on the balance — treat these figures with care"
            : "A second data source was unreachable, so the balance is unconfirmed"}
      </div>

      <details className="report-method">
        <summary>How we checked</summary>
        <ul>
          {report.method.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        <h4>Sources</h4>
        <p>
          {report.sources.length} queries to {[...new Set(report.sources.map((s) => s.provider))].join(" and ")}.
        </p>
        {txs.length > 0 && (
          <p className="tx-list">
            {txs.slice(0, 6).map((h) => (
              <a key={h} className="mono" href={`${CARDANOSCAN}/transaction/${h}`} target="_blank" rel="noreferrer">
                {h.slice(0, 10)}…
              </a>
            ))}
          </p>
        )}
      </details>

      <div className="report-cta">
        <p>
          Teams get this exact report by hiring Atlas on Sokosumi. AI agents buy it for <b>0.50 tUSDM</b> over x402.
        </p>
        <a className="btn" href={sokosumiUrl} target="_blank" rel="noreferrer">
          Hire Atlas on Sokosumi
        </a>
      </div>
    </div>
  );
}
