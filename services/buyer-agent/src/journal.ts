import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type JournalEvent =
  | { type: "offer"; requestId: string; resource: string; payTo: string; amount: string; asset: string; tampered: boolean }
  | { type: "gate"; requestId: string; verdict: string; riskFlags: number; ratingUsed: number; txHash?: string }
  | { type: "paid"; requestId: string; txHash: string; seconds: number }
  | { type: "skipped"; requestId: string; reason: string }
  | { type: "error"; requestId: string; message: string };

/** Append-only JSON lines, read by the dashboard to draw the payment timeline. */
export class Journal {
  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
  }

  write(event: JournalEvent): void {
    appendFileSync(this.file, JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n");
  }
}
