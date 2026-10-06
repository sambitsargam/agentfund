import { Router, json } from "express";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
const actions = ["pay", "tamper", "distribute", "rate"] as const;
type Action = typeof actions[number];
type Job = { id: string; action: Action; lines: string[]; startedAt: number; claimed?: boolean; done?: boolean; ok?: boolean };
type State = { jobs: Job[]; paidRuns: number; blocked?: boolean; last: Partial<Record<Action, number>> };
export function demoApi(dir: string, token = process.env.DEMO_API_TOKEN, taskProgress?: (raw: unknown) => void) {
  const router = Router();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "queue.json");
  let state: State = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { jobs: [], paidRuns: 0, last: {} };
  const save = () => { writeFileSync(file + ".tmp", JSON.stringify(state), { mode: 0o600 }); renameSync(file + ".tmp", file); };
  let heartbeat = 0, automaticKeeper = false;
  const active = () => state.jobs.find(j => !j.done);
  const status = () => ({ enabled: Date.now() - heartbeat < 15000 && !state.blocked, busy: !!active(), runningId: active()?.id ?? null, runningAction: active()?.action ?? null, automaticKeeper, spendingLeft: Math.max(0, 40 - state.paidRuns), cooldown: Object.fromEntries(actions.map(a => [a, Math.max(0, Math.ceil((60000 - (Date.now() - (state.last[a] ?? 0))) / 1000))])) });
  router.use((req, res, next) => {
    const actual = Buffer.from(req.headers.authorization ?? ""), expected = Buffer.from(`Bearer ${token}`);
    if (!token || actual.length !== expected.length || !timingSafeEqual(actual, expected)) { res.status(401).json({ error: "Demo authentication required" }); return; }
    res.setHeader("Cache-Control", "no-store"); next();
  });
  router.use(json({ limit: "100kb" }));
  router.get("/status", (_req, res) => res.json(status()));
  router.get("/job/:id", (req, res) => { const job = state.jobs.find(j => j.id === req.params.id); res.status(job ? 200 : 404).json(job ?? { error: "Run not found" }); });
  // Claim is persisted before returning a job. A lost response never requeues a payment.
  router.post("/runner/claim", (req, res) => {
    heartbeat = Date.now(); automaticKeeper = req.body?.automaticKeeper === true;
    if (req.body?.tasks) taskProgress?.(req.body.tasks);
    const job = active();
    if (!job || job.claimed) { res.json({ job: null }); return; }
    job.claimed = true; save(); res.json({ job });
  });
  router.post("/runner/update/:id", (req, res) => {
    heartbeat = Date.now();
    const job = state.jobs.find(j => j.id === req.params.id);
    if (!job || !job.claimed) { res.status(404).json({ error: "Run not found" }); return; }
    if (job.done) { res.json({ ok: true }); return; }
    if (Array.isArray(req.body?.lines)) job.lines = req.body.lines.filter((l: unknown) => typeof l === "string").slice(-60).map((l: string) => l.slice(0, 300));
    if (req.body?.done === true) { job.done = true; job.ok = req.body.ok === true; if (job.action === "pay" && !job.ok) state.blocked = true; }
    save(); res.json({ ok: true });
  });
  router.post("/:action", (req, res) => {
    const action = req.params.action as Action;
    if (!actions.includes(action)) { res.status(404).json({ error: "Unknown action" }); return; }
    const s = status();
    if (!s.enabled) { res.status(503).json({ error: state.blocked ? "A payment run needs inspection before another run can start." : "Demo runner is offline. The operator's Mac must be awake." }); return; }
    if (s.busy || s.cooldown[action] || (action === "pay" && !s.spendingLeft) || (action === "distribute" && automaticKeeper)) { res.status(429).json({ error: "A run is active, cooling down, or its limit has been reached. Automatic repayment is handled by the keeper.", retryAfter: s.cooldown[action] }); return; }
    const job: Job = { id: randomUUID(), action, startedAt: Date.now(), lines: ["Queued for the live testnet runner…"] };
    state.jobs = state.jobs.slice(-39); state.jobs.push(job); state.last[action] = Date.now(); if (action === "pay") state.paidRuns++;
    save(); res.json({ id: job.id, lines: job.lines });
  });
  return router;
}
