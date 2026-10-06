"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type Action = "pay" | "tamper" | "distribute" | "rate";

const BUTTONS: { action: Action; title: string; blurb: string; tone?: "primary" | "danger" }[] = [
  { action: "pay", title: "Buy a report", blurb: "A customer agent asks Chainlink, then pays 0.50 tUSDM", tone: "primary" },
  { action: "tamper", title: "Try a tampered payment", blurb: "Same request, money redirected — watch it get blocked", tone: "danger" },
  { action: "distribute", title: "Split to the investor", blurb: "Release what the contract is holding" },
  { action: "rate", title: "Refresh the rating", blurb: "Chainlink re-reads earnings and probes Atlas" },
];

/** Links any explorer hash the run prints, so a judge can verify it immediately. */
function Line({ text }: { text: string }) {
  const url = text.match(/https?:\/\/\S+/)?.[0];
  if (!url) return <span>{text}</span>;
  const [before] = text.split(url);
  return (
    <span>
      {before}
      <a href={url} target="_blank" rel="noreferrer">
        {url.replace(/^https?:\/\//, "").replace(/^(preprod\.cardanoscan\.io|sepolia\.basescan\.org)\/(transaction|tx)\//, "$1 · ")}
      </a>
    </span>
  );
}

export function Actions({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState<boolean | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => void (poll.current && clearInterval(poll.current)), []);

  const run = useCallback(
    async (action: Action) => {
      if (busy) return;
      setBusy(action);
      setNote(null);
      setDone(null);
      setLines(["starting…"]);
      const res = await fetch(`/api/demo/${action}`, { method: "POST" });
      const body = (await res.json()) as { id?: string; lines?: string[]; error?: string; retryAfter?: number };
      if (!res.ok || !body.id) {
        setLines([]);
        setNote(body.retryAfter ? `${body.error} Try again in ${body.retryAfter}s.` : (body.error ?? "Could not start that run."));
        setBusy(null);
        return;
      }
      setLines(body.lines ?? []);
      poll.current = setInterval(async () => {
        const r = await fetch(`/api/demo/job/${body.id}`);
        if (!r.ok) return;
        const j = (await r.json()) as { lines: string[]; done: boolean; ok: boolean | null };
        setLines(j.lines);
        if (j.done) {
          if (poll.current) clearInterval(poll.current);
          setBusy(null);
          setDone(j.ok);
          router.refresh();
        }
      }, 1500);
    },
    [busy, router],
  );

  return (
    <div className="panel actions">
      <div className="actions-head">
        <div>
          <h3>Try it yourself</h3>
          <p>
            Each button runs the real thing on test networks: a live Chainlink check, a real Cardano payment, a real split. Every run prints the
            transactions it made.
          </p>
        </div>
        {!enabled && <span className="tag">read-only on this deployment</span>}
      </div>

      <div className="action-grid">
        {BUTTONS.map((b) => (
          <button key={b.action} className={`act ${b.tone ?? ""}`} onClick={() => run(b.action)} disabled={!enabled || busy !== null}>
            <b>
              {busy === b.action && <span className="spin" aria-hidden />}
              {b.title}
            </b>
            <span>{b.blurb}</span>
          </button>
        ))}
      </div>

      {note && <div className="action-note">{note}</div>}

      {lines.length > 0 && (
        <div className={`console ${done === false ? "bad" : done ? "good" : ""}`} aria-live="polite">
          {lines.map((l, i) => (
            <div key={`${i}-${l.slice(0, 24)}`}>
              <Line text={l} />
            </div>
          ))}
          {busy && <div className="muted">working… this takes 30–60 seconds while Cardano confirms</div>}
        </div>
      )}
    </div>
  );
}
