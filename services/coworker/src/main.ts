import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import express from "express";
import { TaskFeed } from "./task-feed.js";
import { demoApi } from "./demo-api.js";
import { fundingApi } from "@agentfund/cardano-tx/funding-http";
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

const dataDir =
  process.env.COWORKER_DATA_DIR ??
  fileURLToPath(new URL("../data", import.meta.url));
const registrationFile = `${dataDir}/registration.json`;
// A hosted worker starts with an empty volume, so the confirmed registration can also be
// supplied as configuration. The file still wins, because `register` keeps it current.
function loadRegistration(): Registration | undefined {
  if (existsSync(registrationFile))
    return JSON.parse(readFileSync(registrationFile, "utf8")) as Registration;
  const configured = process.env.MASUMI_REGISTRATION;
  if (!configured) return undefined;
  const parsed = JSON.parse(configured) as Registration;
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(registrationFile, JSON.stringify(parsed, null, 2) + "\n");
  return parsed;
}
const registration = loadRegistration();
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

const taskFeed = new TaskFeed(`${dataDir}/mirrored-progress.json`);
const app = express();
app.use("/funding", fundingApi());
app.use("/demo", demoApi(`${dataDir}/demo`, process.env.DEMO_API_TOKEN, raw => taskFeed.update(raw)));
app.get("/reliability", (_req, res) =>
  res.json(summarizeReliability(publicTasks().map(t => ({ ...t, input: "", settlement: t.collectionTx ? { verified: true, txHash: t.collectionTx } : undefined })) as TaskState[])),
);
app.get("/health", (_req, res) => {
  const stale =
    !worker.lastPollAt || Date.now() - Date.parse(worker.lastPollAt) > 60_000;
  res
    .status(stale ? 503 : 200)
    .json({
      ok: !stale,
      lastPollAt: worker.lastPollAt,
      paidTasks: worker.paidEnabled,
    });
});
// Public identity, so the dashboard can show where Atlas is registered.
app.get("/agent", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const reg = existsSync(registrationFile)
    ? (JSON.parse(readFileSync(registrationFile, "utf8")) as Record<
        string,
        unknown
      >)
    : undefined;
  res.json({
    coworkerId: process.env.SOKOSUMI_COWORKER_ID ?? null,
    masumi: reg
      ? {
          state: reg.state ?? null,
          agentIdentifier: reg.agentIdentifier ?? null,
          x402ResourcesUrl: reg.x402ResourcesUrl ?? null,
        }
      : null,
    paidTasks: worker.paidEnabled,
  });
});

// Public progress feed only; mirrored records never execute payments on this worker.
function publicTasks() { return taskFeed.merge(store
      .all()
      .map(({ state: s }) => ({
        taskId: s.taskId,
        stage: s.stage,
        marketplaceStatus: s.marketplaceStatus ?? null,
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
      }))); }
app.get("/tasks", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); res.json(publicTasks());
});
app.listen(Number(process.env.PORT ?? process.env.COWORKER_PORT ?? 4030));

console.log(
  `atlas coworker worker started; paid Tasks ${worker.paidEnabled ? "enabled" : "disabled (no Masumi registration yet)"}`,
);
for (;;) {
  try {
    await worker.poll();
  } catch (err) {
    console.error(
      new Date().toISOString(),
      `poll failed: ${(err as Error).message}`,
    );
  }
  await new Promise((r) => setTimeout(r, 5_000));
}
