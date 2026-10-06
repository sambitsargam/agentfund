import { config } from "dotenv";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
config({ path: resolve(".env") });
config({ path: resolve(".env.demo-runner") });
process.env.AGENTFUND_ROOT = process.cwd();
const { start, status } = await import("../apps/web/lib/jobs.js");
const base = process.env.DEMO_API_URL, token = process.env.DEMO_API_TOKEN;
if (!base?.startsWith("https://") || !token) throw new Error("Demo runner connection is not configured");
const dir = resolve("services/keeper/data/demo-claims"); mkdirSync(dir, { recursive: true });
const call = async (path: string, body: unknown) => {
  const r = await fetch(`${base}/${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Demo queue HTTP ${r.status}`); return r.json();
};
const safe = (lines: string[]) => lines.map(line => {
  for (const [key, value] of Object.entries(process.env)) if (/KEY|TOKEN|MNEMONIC|SECRET|PASSWORD/.test(key) && value && value.length > 10) line = line.split(value).join("[redacted]");
  return line.slice(0, 300);
});
let current: { id: string; job: ReturnType<typeof start> } | undefined;
console.log("Demo runner connected; testnet actions only. Keep this Mac awake.");
for (;;) {
  try {
    if (current) {
      await call(`runner/update/${current.id}`, { lines: safe(current.job.lines), done: current.job.finishedAt !== undefined, ok: current.job.ok });
      if (current.job.finishedAt !== undefined) current = undefined;
    } else {
      const progress = await fetch("http://127.0.0.1:4030/tasks", { signal: AbortSignal.timeout(3000) }).then(r => r.ok ? r.json() : undefined).catch(() => undefined);
      const { job } = await call("runner/claim", { tasks: progress, automaticKeeper: process.env.DEMO_AUTOMATIC_KEEPER === "true" || status().automaticKeeper });
      if (job) {
        if (!/^[0-9a-f-]{36}$/.test(job.id) || !["pay", "tamper", "rate", "distribute"].includes(job.action)) throw new Error("Invalid queue job");
        const marker = resolve(dir, job.id);
        if (existsSync(marker)) throw new Error("Previously claimed job requires manual inspection");
        writeFileSync(marker, JSON.stringify({ action: job.action, at: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
        try { current = { id: job.id, job: start(job.action) }; }
        catch { await call(`runner/update/${job.id}`, { done: true, ok: false, lines: ["Runner refused the action; inspect its current state before retrying."] }); }
      }
    }
  } catch { console.error("Queue connection or job needs attention; no payment automatically retried."); }
  await new Promise(r => setTimeout(r, 2000));
}
