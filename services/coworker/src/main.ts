import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import express from "express";
import { CoreClient, MpsClient } from "./clients.js";
import { TaskStore } from "./store.js";
import { CoworkerWorker, type Registration, type TaskState } from "./worker.js";
import { summarizeReliability } from "./reliability.js";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
config({ path: fileURLToPath(new URL("../.env.local", import.meta.url)) });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const dataDir = process.env.COWORKER_DATA_DIR ?? fileURLToPath(new URL("../data", import.meta.url));
const registrationFile = `${dataDir}/registration.json`;
const registration = existsSync(registrationFile)
  ? (JSON.parse(readFileSync(registrationFile, "utf8")) as Registration)
  : undefined;
const mpsToken = process.env.MPS_RUNTIME_TOKEN;

const store = new TaskStore<TaskState>(`${dataDir}/tasks`);
const worker = new CoworkerWorker({
  core: new CoreClient(required("SOKOSUMI_COWORKER_API_KEY")),
  mps: mpsToken ? new MpsClient(required("MPS_URL"), mpsToken) : undefined,
  registration,
  store,
  blockfrostProjectId: required("BLOCKFROST_PROJECT_ID"),
  log: (msg) => console.log(new Date().toISOString(), msg),
});

const app = express();
app.get("/reliability", (_req, res) => res.json(summarizeReliability(store.all().map(t => t.state))));
app.get("/health", (_req, res) => {
  const stale = !worker.lastPollAt || Date.now() - Date.parse(worker.lastPollAt) > 60_000;
  res.status(stale ? 503 : 200).json({ ok: !stale, lastPollAt: worker.lastPollAt, paidTasks: worker.paidEnabled });
});
// Public identity, so the dashboard can show where Atlas is registered.
app.get("/agent", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const reg = existsSync(registrationFile) ? (JSON.parse(readFileSync(registrationFile, "utf8")) as Record<string, unknown>) : undefined;
  res.json({
    coworkerId: process.env.SOKOSUMI_COWORKER_ID ?? null,
    masumi: reg
      ? { state: reg.state ?? null, agentIdentifier: reg.agentIdentifier ?? null, x402ResourcesUrl: reg.x402ResourcesUrl ?? null }
      : null,
    paidTasks: worker.paidEnabled,
  });
});

// Public progress feed for the dashboard. Task inputs and results stay private.
app.get("/tasks", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json(
    store
      .all()
      .map(({ state: s }) => ({
        taskId: s.taskId,
        stage: s.stage,
        paid: s.paid,
        delivered: s.delivered ?? null,
        startedAt: s.startedAt,
        updatedAt: s.updatedAt ?? null,
        purchaseEventId: s.purchaseEventId ?? null,
        completionEventId: s.completionEventId ?? null,
        blockchainIdentifier: s.terms?.blockchainIdentifier ?? null,
        submitResultTime: s.terms?.submitResultTime ?? null,
        unlockTime: s.terms?.unlockTime ?? null,
        onChainState: s.onChainState ?? null,
        resultHash: s.resultHash ?? null,
        collectionTx: s.settlement?.txHash ?? null,
        collectedAtomicUnits: s.settlement?.netAtomicUnits ?? null,
        collectionAddress: registration?.payoutAddress ?? null,
        error: s.error ?? null,
      }))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
  );
});
app.listen(Number(process.env.PORT ?? process.env.COWORKER_PORT ?? 4030));

console.log(`atlas coworker worker started; paid Tasks ${worker.paidEnabled ? "enabled" : "disabled (no Masumi registration yet)"}`);
for (;;) {
  try {
    await worker.poll();
  } catch (err) {
    console.error(new Date().toISOString(), `poll failed: ${(err as Error).message}`);
  }
  await new Promise((r) => setTimeout(r, 5_000));
}
