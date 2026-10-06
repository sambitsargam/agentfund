"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { outcomeFor, gateExplanation } from "../../lib/demo-outcome";

type Action = "pay" | "tamper" | "distribute" | "rate";
type StepState = "pending" | "active" | "done" | "blocked";

interface Step {
  title: string;
  note?: string;
  state: StepState;
  href?: string;
  hash?: string;
}

const CARDANOSCAN = "https://preprod.cardanoscan.io/transaction/";
const BASESCAN = "https://sepolia.basescan.org/tx/";

const BUTTONS: {
  action: Action;
  title: string;
  blurb: string;
  tone?: "primary" | "danger";
}[] = [
  {
    action: "pay",
    title: "Let an agent buy a report",
    blurb: "Another AI agent pays Atlas 0.50 tUSDM and gets a report back",
    tone: "primary",
  },
  {
    action: "tamper",
    title: "Try to pay the wrong address",
    blurb:
      "The same payment, aimed away from the contract. Chainlink should refuse it",
    tone: "danger",
  },
  {
    action: "distribute",
    title: "Pay the backer",
    blurb: "Release what the contract is holding, backer first",
    tone: undefined,
  },
  {
    action: "rate",
    title: "Re-check Atlas",
    blurb: "Chainlink re-reads its earnings and tests that it still answers",
  },
];

const TITLES: Record<Action, string[]> = {
  pay: [
    "Customer agent asks Atlas to check a wallet",
    "Chainlink checks Atlas",
    "Paying on Cardano",
    "Locked in the investor contract",
    "Report delivered",
  ],
  tamper: [
    "Customer agent asks Atlas to check a wallet",
    "Chainlink checks Atlas",
    "Paying on Cardano",
    "Locked in the investor contract",
    "Report delivered",
  ],
  distribute: [
    "Contract holds the payments",
    "Investor receives 10%",
    "Atlas receives 90%",
  ],
  rate: [
    "Reading Atlas's earnings on Cardano",
    "Probing Atlas's service",
    "Rating written to Base Sepolia",
  ],
};

/** Turns the run's log lines into steps a non-engineer can follow. */
function toSteps(
  action: Action,
  lines: string[],
  done: boolean,
  subject?: string,
): Step[] {
  const titles = TITLES[action];
  const steps: Step[] = titles.map((title) => ({ title, state: "pending" }));
  const text = lines.join("\n");
  const grab = (re: RegExp) => text.match(re)?.[1];

  if (action === "pay" || action === "tamper") {
    const offer = grab(/offer: ([\d.]+) tUSDM/);
    const gateTx = grab(
      /https:\/\/sepolia\.basescan\.org\/tx\/(0x[0-9a-f]{64})/,
    );
    const payTx = grab(
      /https:\/\/preprod\.cardanoscan\.io\/transaction\/([0-9a-f]{64})/,
    );
    const verdict = grab(/gate: (ALLOW|DENY|REVIEW)/);
    const seconds = grab(/paid in ([\d.]+) s/);
    const report = grab(/report verdict: (\w+)/);

    if (offer)
      steps[0] = {
        ...steps[0]!,
        state: "done",
        note: subject
          ? `${subject.slice(0, 16)}…${subject.slice(-6)} · ${offer} tUSDM quoted`
          : `${offer} tUSDM quoted`,
      };
    if (/asking the Chainlink payment gate/.test(text))
      steps[1] = { ...steps[1]!, state: "active" };
    if (verdict) {
      const blocked = verdict !== "ALLOW";
      steps[1] = {
        ...steps[1]!,
        state: blocked ? "blocked" : "done",
        note: blocked
          ? gateExplanation(lines).note
          : "rating ✓ · money goes to the investor contract ✓ · 2 AI auditors ✓",
        href: gateTx ? BASESCAN + gateTx : undefined,
        hash: gateTx,
      };
      if (blocked) return steps;
      steps[2] = {
        ...steps[2]!,
        state: payTx ? "done" : "active",
        note: payTx
          ? `submitted in ${seconds ?? "~30"} s; open the explorer to check confirmation`
          : "Cardano confirms in about 20–60 seconds",
      };
    }
    if (payTx) {
      steps[2] = {
        ...steps[2]!,
        state: "done",
        href: CARDANOSCAN + payTx,
        hash: payTx,
      };
      steps[3] = {
        ...steps[3]!,
        state: "done",
        note: "receipt carries the Chainlink approval id",
      };
    }
    if (report)
      steps[4] = {
        ...steps[4]!,
        state: "done",
        note: `history warning level: ${report} (experimental)`,
      };
    else if (payTx && !done) steps[4] = { ...steps[4]!, state: "active" };
    return steps;
  }

  if (action === "distribute") {
    const coins = grab(/distributed (\d+) coin/);
    const investor = grab(/Investor [^:]*: ([\d.]+) tUSDM/);
    const atlas = grab(/Atlas: ([\d.]+) tUSDM/);
    const tx = grab(
      /https:\/\/preprod\.cardanoscan\.io\/transaction\/([0-9a-f]{64})/,
    );
    if (coins)
      steps[0] = {
        ...steps[0]!,
        state: "done",
        note: `${coins} payment${coins === "1" ? "" : "s"} settled together`,
      };
    if (investor)
      steps[1] = {
        ...steps[1]!,
        state: "done",
        note: `${investor} tUSDM`,
        href: tx ? CARDANOSCAN + tx : undefined,
        hash: tx,
      };
    if (atlas)
      steps[2] = {
        ...steps[2]!,
        state: "done",
        note: `${atlas} tUSDM`,
        href: tx ? CARDANOSCAN + tx : undefined,
        hash: tx,
      };
    if (/nothing to distribute/.test(text))
      steps[0] = {
        ...steps[0]!,
        state: "done",
        note: "nothing waiting to be split",
      };
    return steps;
  }

  const earnings = grab(/"earnings":"(\d+)"/);
  const probe = /"probeOk":true/.test(text);
  const score = grab(/"score":"(\d+)"/);
  const tx = grab(/written: (0x[0-9a-f]{64})/);
  if (earnings)
    steps[0] = {
      ...steps[0]!,
      state: "done",
      note: `${(Number(earnings) / 1e6).toString()} tUSDM earned`,
    };
  if (score)
    steps[1] = {
      ...steps[1]!,
      state: probe ? "done" : "blocked",
      note: probe ? "service answered" : "no answer",
    };
  if (tx)
    steps[2] = {
      ...steps[2]!,
      state: "done",
      note: `score ${score}`,
      href: BASESCAN + tx,
      hash: tx,
    };
  else if (/Rating unchanged/.test(text))
    steps[2] = {
      ...steps[2]!,
      state: "done",
      note: "unchanged, no write needed",
    };
  return steps;
}

/** Says plainly whether the run did what the button promised. A blocked tamper is a success. */
function Outcome({
  action,
  lines,
  ok,
}: {
  action: Action;
  lines: string[];
  ok: boolean | null;
}) {
  const { tone, title, body } = outcomeFor(action, lines, ok);
  return (
    <div className={`outcome ${tone}`}>
      <b>{title}</b>
      <span>{body}</span>
    </div>
  );
}

export function Actions({
  enabled,
  videoUrl,
  subject,
}: {
  enabled: boolean;
  videoUrl?: string;
  subject?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [ok, setOk] = useState<boolean | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [runId, setRunId] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [server, setServer] = useState<{
    busy: boolean;
    runningId: string | null;
    runningAction: Action | null;
    cooldown: Record<Action, number>;
    automaticKeeper: boolean;
  } | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const followed = useRef<string | null>(null);

  const follow = useCallback(
    (id: string, which: Action) => {
      if (followed.current === id) return;
      followed.current = id;
      setRunId(id);
      setLines([]);
      setAction(which);
      setBusy(which);
      setDone(false);
      setOk(null);
      if (poll.current) clearInterval(poll.current);
      poll.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/demo/job/${id}`);
          if (!r.ok) {
            if (poll.current) clearInterval(poll.current);
            setBusy(null);
            if (tick.current) clearInterval(tick.current);
            setOk(false);
            setDone(true);
            return;
          }
          const j = (await r.json()) as {
            action: Action;
            lines: string[];
            done: boolean;
            ok: boolean | null;
          };
          if (followed.current !== id) return;
          setAction(j.action);
          setLines(j.lines);
          if (j.done) {
            if (poll.current) clearInterval(poll.current);
            if (tick.current) clearInterval(tick.current);
            setBusy(null);
            setDone(true);
            setOk(j.ok);
            router.refresh();
          }
        } catch {
          if (poll.current) clearInterval(poll.current);
          if (tick.current) clearInterval(tick.current);
          setBusy(null);
          setOk(null);
          setDone(true);
          setNote(
            "Connection lost. Check the transaction links before starting another run.",
          );
        }
      }, 1500);
    },
    [router],
  );

  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const read = async () => {
      try {
        const r = await fetch("/api/demo/status");
        const s = (await r.json()) as {
          enabled: boolean;
          busy?: boolean;
          runningId?: string | null;
          runningAction?: Action | null;
          cooldown?: Record<Action, number>;
          automaticKeeper?: boolean;
        };
        if (stop || !s.enabled) return;
        setServer({
          busy: Boolean(s.busy),
          runningId: s.runningId ?? null,
          runningAction: s.runningAction ?? null,
          cooldown: s.cooldown ?? ({} as Record<Action, number>),
          automaticKeeper: Boolean(s.automaticKeeper),
        });
        // Someone else started a run: watch it rather than showing a refusal.
        if (s.busy && s.runningId && s.runningAction)
          follow(s.runningId, s.runningAction);
      } catch {
        /* the page still works without the status */
      }
    };
    void read();
    const id = setInterval(read, 3000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [enabled, follow]);

  useEffect(
    () => () => {
      if (poll.current) clearInterval(poll.current);
      if (tick.current) clearInterval(tick.current);
    },
    [],
  );

  const run = useCallback(
    async (next: Action) => {
      if (busy) return;
      setBusy(next);
      setAction(next);
      setNote(null);
      setDone(false);
      setOk(null);
      setLines([]);
      setShowLog(false);
      setRunId(null);
      setElapsed(0);
      const started = Date.now();
      tick.current = setInterval(
        () => setElapsed(Math.round((Date.now() - started) / 1000)),
        1000,
      );

      try {
        const res = await fetch(`/api/demo/${next}`, { method: "POST" });
        const body = (await res.json()) as {
          id?: string;
          lines?: string[];
          error?: string;
          retryAfter?: number;
        };
        if (!res.ok || !body.id) {
          if (tick.current) clearInterval(tick.current);
          setNote(
            body.retryAfter
              ? `${body.error} Try again in ${body.retryAfter}s.`
              : (body.error ?? "Could not start that run."),
          );
          setBusy(null);
          setAction(null);
          return;
        }
        setLines(body.lines ?? []);
        follow(body.id, next);
      } catch {
        if (tick.current) clearInterval(tick.current);
        setBusy(null);
        setOk(null);
        setDone(true);
        setNote(
          "Could not verify whether the run started. Check the server status before trying again.",
        );
      }
    },
    [busy, follow],
  );

  const steps = action ? toSteps(action, lines, done, subject) : [];

  return (
    <div className="panel actions">
      <div className="actions-intro">
        <p>
          <b>These buttons spend real money on test networks.</b> Nothing here
          is a simulation or a recording: each one builds a transaction, signs
          it and waits for Cardano or Base Sepolia to accept it, which takes
          twenty to sixty seconds.
        </p>
        <p>
          The first button is how Atlas actually earns. Another AI agent pays it
          0.50 tUSDM and gets back the same kind of report you can run for free
          under <b>Check a wallet</b>. The second button sends that identical
          payment to the wrong address, so you can watch Chainlink refuse it
          before any money moves &mdash; a blocked payment there is the demo
          working, not failing.
        </p>
        <p className="muted small">
          Only one run can happen at a time. If a button says another run is in
          progress, someone else is using it and their steps will appear below
          as they happen.
        </p>
      </div>

      {enabled ? (
        <div className="action-grid">
          {BUTTONS.map((b) => {
            const wait = server?.cooldown?.[b.action] ?? 0;
            const running = server?.busy ?? busy !== null;
            const mine = busy === b.action;
            const automatic =
              b.action === "distribute" && server?.automaticKeeper;
            const blocked = running || wait > 0 || Boolean(automatic);
            const why = automatic
              ? "Automatic repayment is active"
              : mine
                ? "running…"
                : running
                  ? "another run is in progress"
                  : wait > 0
                    ? `ready in ${wait}s`
                    : b.blurb;
            return (
              <button
                key={b.action}
                className={`act ${b.tone ?? ""}`}
                onClick={() => void run(b.action)}
                disabled={blocked}
                title={blocked ? why : undefined}
              >
                <b>
                  {mine && <span className="spin" aria-hidden />}
                  {b.title}
                </b>
                <span>{why}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="readonly">
          <p>
            Live runs are switched off here. The recorded run shows the same
            thing end to end, and every payment below is a real transaction you
            can open.
          </p>
          {videoUrl && (
            <a
              className="btn primary"
              href={videoUrl}
              target="_blank"
              rel="noreferrer"
            >
              Watch the recorded run
            </a>
          )}
        </div>
      )}

      {note && <div className="action-note">{note}</div>}

      {action && (
        <p className="action-note">
          {done ? "Last completed run" : "Current run"}:{" "}
          {BUTTONS.find((b) => b.action === action)?.title}
          {runId && <> · run {runId.slice(0, 8)}</>}
          {done && (
            <button
              className="log-toggle"
              onClick={() => {
                setAction(null);
                setLines([]);
                setShowLog(false);
                setNote(null);
              }}
            >
              Dismiss result
            </button>
          )}
        </p>
      )}

      {steps.length > 0 && done && action && (
        <Outcome action={action} lines={lines} ok={ok} />
      )}

      {steps.length > 0 && (
        <>
          <ol className="timeline">
            {steps.map((s, i) => (
              <li key={s.title} className={`tl ${s.state}`}>
                <span className="dot">
                  {s.state === "done" ? (
                    "✓"
                  ) : s.state === "blocked" ? (
                    "✕"
                  ) : s.state === "active" ? (
                    <span className="spin small" aria-hidden />
                  ) : (
                    i + 1
                  )}
                </span>
                <div>
                  <b>{s.title}</b>
                  {s.note && <span>{s.note}</span>}
                  {s.href && (
                    <a
                      className="mono"
                      href={s.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {s.hash?.slice(0, 10)}… ↗
                    </a>
                  )}
                  {s.state === "active" && (
                    <span className="muted">{elapsed}s elapsed</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <button className="log-toggle" onClick={() => setShowLog((v) => !v)}>
            {showLog ? "Hide technical log" : "Show technical log"}
          </button>
          {showLog && (
            <div className="console">
              {lines.map((l, i) => (
                <div key={`${i}-${l.slice(0, 20)}`}>{l}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
