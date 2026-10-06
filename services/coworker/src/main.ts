import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import express from "express";
import { CoreClient, MpsClient } from "./clients.js";
import { TaskStore } from "./store.js";
import { CoworkerWorker, type Registration, type TaskState } from "./worker.js";

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

const worker = new CoworkerWorker({
  core: new CoreClient(required("SOKOSUMI_COWORKER_API_KEY")),
  mps: mpsToken ? new MpsClient(required("MPS_URL"), mpsToken) : undefined,
  registration,
  store: new TaskStore<TaskState>(`${dataDir}/tasks`),
  blockfrostProjectId: required("BLOCKFROST_PROJECT_ID"),
  log: (msg) => console.log(new Date().toISOString(), msg),
});

const app = express();
app.get("/health", (_req, res) => {
  const stale = !worker.lastPollAt || Date.now() - Date.parse(worker.lastPollAt) > 60_000;
  res.status(stale ? 503 : 200).json({ ok: !stale, lastPollAt: worker.lastPollAt, paidTasks: worker.paidEnabled });
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
