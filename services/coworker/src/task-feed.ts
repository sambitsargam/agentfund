import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
// Mirror only the public progress fields; never Task descriptions, reports, or signing material.
const fields = ["taskId", "stage", "marketplaceStatus", "paid", "delivered", "startedAt", "updatedAt", "purchaseEventId", "completionEventId", "blockchainIdentifier", "submitResultTime", "unlockTime", "onChainState", "resultHash", "collectionTx", "collectedAtomicUnits", "collectionAddress"];
type Row = Record<string, any>;
export class TaskFeed {
  constructor(private file: string) { mkdirSync(dirname(file), { recursive: true }); }
  update(raw: unknown) {
    if (!Array.isArray(raw) || raw.length > 100) return;
    const rows = raw.filter(r => r && /^[0-9a-f-]{36}$/.test(r.taskId) && typeof r.stage === "string" && typeof r.startedAt === "string").map(r => Object.fromEntries(fields.map(k => [k, ["string", "boolean"].includes(typeof r[k]) ? (typeof r[k] === "string" ? r[k].slice(0, 300) : r[k]) : null])));
    writeFileSync(this.file + ".tmp", JSON.stringify({ observedAt: new Date().toISOString(), rows }), { mode: 0o600 }); renameSync(this.file + ".tmp", this.file);
  }
  merge(local: Row[]) {
    const saved = existsSync(this.file) ? JSON.parse(readFileSync(this.file, "utf8")) : { rows: [] };
    const byId = new Map(local.map(r => [r.taskId, r]));
    for (const row of saved.rows) {
      const here = byId.get(row.taskId);
      // Only replace an absent record or a record that cannot progress without recovery.
      // The mirror is for display and never enters the execution store.
      if (!here || here.stage === "needs-recovery") byId.set(row.taskId, { ...row, progressSource: "local-worker", sourceObservedAt: saved.observedAt, sourceStale: Date.now() - Date.parse(saved.observedAt) > 30000 });
    }
    return [...byId.values()].sort((a,b) => b.startedAt.localeCompare(a.startedAt));
  }
}
