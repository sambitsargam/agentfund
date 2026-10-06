import { mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { repositoryRoot } from "./repository.js";
import { randomUUID } from "node:crypto";
import { buildRound, type RoundConfig } from "./round.js";

export function roundsDirectory() {
  const root = repositoryRoot();
  return process.env.FUNDING_DATA_DIR ?? resolve(root, "services/keeper/data/funding");
}
export function safeId(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error("Invalid funding identifier");
  return id;
}
/** Public configuration and unsigned transactions only. No keys or signing capability. */
export class RoundStore {
  constructor(readonly dir = roundsDirectory()) {}
  private path(kind: string, id: string) { return resolve(this.dir, kind, safeId(id) + ".json"); }
  read<T>(kind: "rounds" | "tickets", id: string): T | null {
    const file = this.path(kind, id);
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as T : null;
  }
  write(kind: "rounds" | "tickets", id: string, value: unknown) {
    const file = this.path(kind, id);
    mkdirSync(resolve(this.dir, kind), { recursive: true });
    const tmp = file + "." + randomUUID() + ".tmp";
    writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, file);
  }
  rounds(): RoundConfig[] {
    const dir = resolve(this.dir, "rounds");
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter(f => f.endsWith(".json")).map(f => {
      const c = this.read<RoundConfig>("rounds", f.slice(0, -5))!;
      if (c.id !== buildRound(c).hash) throw new Error("Round identity does not match its terms");
      return c;
    });
  }
  round(id: string): RoundConfig {
    const c = this.read<RoundConfig>("rounds", id);
    if (!c || c.id !== buildRound(c).hash) throw new Error("Round not found");
    return c;
  }
}
