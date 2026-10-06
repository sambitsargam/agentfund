import "server-only";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

export type ActionName = "pay" | "tamper" | "distribute" | "rate";

export interface Job {
  id: string;
  action: ActionName;
  startedAt: number;
  finishedAt?: number;
  ok?: boolean;
  lines: string[];
}

// process.cwd() is apps/web when Next runs; the workspace root is two levels up.
const REPO = process.env.AGENTFUND_ROOT ?? resolve(process.cwd(), "../..");
const CRE = process.env.CRE_BIN ?? `${process.env.HOME}/.cre/bin/cre`;

interface Spec {
  label: string;
  command: string;
  args: string[];
  cwd: string;
  /** Minimum seconds between runs of this action. */
  cooldown: number;
  /** Spends test money, so it also counts against the shared budget. */
  spends: boolean;
}

const SPECS: Record<ActionName, Spec> = {
  pay: {
    label: "Buying a wallet report",
    command: "npm",
    args: ["run", "-s", "buy", "-w", "@agentfund/buyer-agent", "--", process.env.DEMO_SUBJECT ?? "addr_test1wzs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgn37w4g"],
    cwd: REPO,
    cooldown: 45,
    spends: true,
  },
  tamper: {
    label: "Trying a tampered payment",
    command: "npm",
    args: ["run", "-s", "buy", "-w", "@agentfund/buyer-agent", "--", process.env.DEMO_SUBJECT ?? "addr_test1wzs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgn37w4g", "--tamper"],
    cwd: REPO,
    cooldown: 45,
    spends: false, // the gate denies it, so nothing is paid
  },
  distribute: {
    label: "Splitting payments to the investor",
    command: "npm",
    args: ["run", "-s", "distribute", "-w", "@agentfund/keeper"],
    cwd: REPO,
    cooldown: 30,
    spends: false,
  },
  rate: {
    label: "Refreshing the Chainlink rating",
    command: CRE,
    args: ["workflow", "simulate", "rate-atlas", "--target", "staging-settings", "--non-interactive", "--trigger-index", "0", "--broadcast"],
    cwd: `${REPO}/workflows/rating`,
    cooldown: 60,
    spends: false,
  },
};

const MAX_SPENDING_RUNS = Number(process.env.DEMO_MAX_PAID_RUNS ?? 40);
const MAX_LINES = 60;

const jobs = new Map<string, Job>();
const lastRun = new Map<ActionName, number>();
let running: string | null = null;
let spendingRuns = 0;

export class Refused extends Error {
  constructor(
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

/** One run at a time, a cooldown per action, and a hard cap on runs that spend test money. */
export function start(action: ActionName): Job {
  const spec = SPECS[action];
  if (!spec) throw new Refused("Unknown action");
  if (running && jobs.get(running)?.finishedAt === undefined) {
    throw new Refused("Another demo run is in progress. Give it a few seconds.");
  }
  const since = (Date.now() - (lastRun.get(action) ?? 0)) / 1000;
  if (since < spec.cooldown) {
    throw new Refused("This action is rate limited so the demo wallet lasts.", Math.ceil(spec.cooldown - since));
  }
  if (spec.spends && spendingRuns >= MAX_SPENDING_RUNS) {
    throw new Refused("The demo spending cap for this deployment has been reached.");
  }

  const job: Job = { id: randomUUID(), action, startedAt: Date.now(), lines: [`${spec.label}…`] };
  jobs.set(job.id, job);
  running = job.id;
  lastRun.set(action, Date.now());
  if (spec.spends) spendingRuns += 1;

  const child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: process.env });
  const push = (chunk: Buffer) => {
    for (const raw of chunk.toString().split("\n")) {
      const line = raw.trim();
      // Keep the human-readable progress, drop npm noise and stack traces.
      if (!line || /^\s*at |node:internal|npm (warn|notice)|^>/.test(line)) continue;
      job.lines.push(line.replace(/^\d{4}-\d{2}-\d{2}T\S+\s+\[USER LOG\]\s*/, ""));
      if (job.lines.length > MAX_LINES) job.lines.splice(0, job.lines.length - MAX_LINES);
    }
  };
  child.stdout.on("data", push);
  child.stderr.on("data", push);
  child.on("error", (err) => {
    job.lines.push(`could not start: ${err.message}`);
  });
  child.on("close", (code) => {
    job.finishedAt = Date.now();
    job.ok = code === 0;
    if (!job.ok) job.lines.push(`run exited with code ${code}`);
    running = null;
    setTimeout(() => jobs.delete(job.id), 10 * 60_000).unref?.();
  });

  // A run should never outlive a demo; kill it rather than block the next one.
  setTimeout(() => child.killed || child.kill("SIGTERM"), 4 * 60_000).unref?.();
  return job;
}
