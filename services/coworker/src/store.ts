import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * One JSON file per Task, written atomically before every external call, so a restart
 * resumes from the last confirmed step instead of repeating a payment or completion.
 */
export class TaskStore<T extends object> {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  read(taskId: string): T | undefined {
    const file = this.file(taskId);
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : undefined;
  }

  write(taskId: string, state: T): T {
    const file = this.file(taskId);
    writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    return state;
  }

  all(): { taskId: string; state: T }[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ taskId: f.slice(0, -5), state: JSON.parse(readFileSync(join(this.dir, f), "utf8")) as T }));
  }

  private file(taskId: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw new Error("unexpected Task id");
    return join(this.dir, `${taskId}.json`);
  }
}
