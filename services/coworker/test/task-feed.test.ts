import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskFeed } from "../src/task-feed.js";
describe("read-only worker progress mirror", () => {
  it("shows the active worker's progress without overwriting a local execution record or storing report text", () => {
    const file = join(mkdtempSync(join(tmpdir(), "task-feed-")), "feed.json"); const feed = new TaskFeed(file);
    const row = { taskId: "01a1135f-d2a4-727a-89aa-e049abdccab1", stage: "awaiting-result", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), input: "private", result: "private", paid: true };
    feed.update([row]);
    expect(readFileSync(file, "utf8")).not.toContain("private");
    expect(feed.merge([{ ...row, stage: "needs-recovery" }])[0]?.stage).toBe("awaiting-result");
    expect(feed.merge([{ ...row, stage: "settled" }])[0]?.stage).toBe("settled");
  });
});
