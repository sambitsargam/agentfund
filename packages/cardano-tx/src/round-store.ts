import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  renameSync,
  existsSync,
} from "node:fs";
import { resolve } from "node:path";
import { repositoryRoot } from "./repository.js";
import { randomUUID } from "node:crypto";
import { buildRound, type RoundConfig } from "./round.js";

export function roundsDirectory() {
  const root = repositoryRoot();
  // Published round configuration sits outside services/keeper/data, which is ignored for the
  // keeper's runtime journal. Deploy uploads do not honour git's re-inclusion rules, so a round
  // kept under an ignored directory never reaches the image.
  return process.env.FUNDING_DATA_DIR ?? resolve(root, "data/funding");
}
export function safeId(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id))
    throw new Error("Invalid funding identifier");
  return id;
}
/** Public configuration and unsigned transactions only. No keys or signing capability. */
export class RoundStore {
  constructor(readonly dir = roundsDirectory()) {}
  private path(kind: string, id: string) {
    return resolve(this.dir, kind, safeId(id) + ".json");
  }
  read<T>(kind: "rounds" | "tickets", id: string): T | null {
    const file = this.path(kind, id);
    return existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as T)
      : null;
  }
  write(kind: "rounds" | "tickets", id: string, value: unknown) {
    const file = this.path(kind, id);
    mkdirSync(resolve(this.dir, kind), { recursive: true });
    const tmp = file + "." + randomUUID() + ".tmp";
    writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, file);
  }
  private bundled(): RoundConfig[] {
    const file = resolve(repositoryRoot(), "docs/samples/funding-rounds.json");
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  }
  private validate(c: RoundConfig) {
    if (c.id !== buildRound(c).hash)
      throw new Error("Round identity does not match its terms");
    return c;
  }
  rounds(): RoundConfig[] {
    const dir = resolve(this.dir, "rounds");
    const local = existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith(".json"))
          .map((f) => this.read<RoundConfig>("rounds", f.slice(0, -5))!)
      : [];
    const merged = new Map(
      [...this.bundled(), ...local].map((c) => [c.id, this.validate(c)]),
    );
    return [...merged.values()];
  }
  round(id: string): RoundConfig {
    safeId(id);
    const c =
      this.read<RoundConfig>("rounds", id) ??
      this.bundled().find((c) => c.id === id);
    if (!c) throw new Error("Round not found");
    return this.validate(c);
  }
}
