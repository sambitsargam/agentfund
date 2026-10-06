import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { BLOCKFROST_PREPROD_URL } from "@agentfund/shared";
import { keeperTick, type KeeperState } from "./controller.js";
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
const root = fileURLToPath(new URL("../../../", import.meta.url));
const dir = process.env.KEEPER_DATA_DIR ?? `${root}/services/keeper/data`;
mkdirSync(dir, { recursive: true });
const file = `${dir}/status.json`, lock = `${dir}/loop.lock`;
// Stale locks need human inspection, never auto-expire while a transaction may be in flight.
const fd = openSync(lock, "wx", 0o600); closeSync(fd);
process.on("exit", () => { try { unlinkSync(lock); } catch {} });
let stopping = false;
process.on("SIGINT", () => { stopping = true; }); process.on("SIGTERM", () => { stopping = true; });
const now = () => new Date().toISOString();
const read = (): KeeperState => existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { stage: "idle", updatedAt: now(), cycles: 0 };
const save = (s: KeeperState) => { writeFileSync(`${file}.tmp`, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 }); renameSync(`${file}.tmp`, file); };
const run = (action: "sweep" | "distribute") => new Promise<{ hash?: string; empty: boolean }>((resolve, reject) => {
  const child = spawn("npm", ["run", "-s", action, "-w", "@agentfund/keeper"], { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  const collect = (b: Buffer) => { output = (output + b.toString()).slice(-16000); };
  child.stdout.on("data", collect); child.stderr.on("data", collect);
  const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("Command timed out")); }, 180000);
  child.on("error", e => { clearTimeout(timer); reject(e); });
  child.on("close", code => { clearTimeout(timer); const hash = output.match(/cardanoscan\.io\/transaction\/([0-9a-f]{64})/)?.[1];
    if (hash) resolve({ hash, empty: false }); else if (code === 0 && /nothing to (sweep|distribute)/.test(output)) resolve({ empty: true }); else reject(new Error("Command outcome uncertain")); });
});
do {
  const s = await keeperTick({ read, save, run, now, confirmed: async hash => {
    const r = await fetch(`${BLOCKFROST_PREPROD_URL}/txs/${hash}`, { headers: { project_id: process.env.BLOCKFROST_PROJECT_ID! }, signal: AbortSignal.timeout(15000) });
    if (r.status === 404) return false;
    if (!r.ok) throw new Error("Chain unavailable");
    return Number((await r.json()).block_height) > 0;
  } });
  console.log(JSON.stringify({ stage: s.stage, cycles: s.cycles, updatedAt: s.updatedAt, reason: s.reason }));
  if (process.argv.includes("--once") || s.stage === "blocked" || stopping) break;
  await new Promise(r => setTimeout(r, 30000));
} while (!stopping);
