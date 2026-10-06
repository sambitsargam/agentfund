import { describe, it, expect } from "vitest";
import express from "express";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { demoApi } from "../src/demo-api.js";
// Exercise the actual HTTP boundary without executing a demo command.
async function fixture(dir = mkdtempSync(join(tmpdir(), "demo-queue-"))) {
  const app = express(); app.use("/demo", demoApi(dir, "test"));
  const server = app.listen(0); await new Promise<void>(r => server.once("listening", r));
  const address = server.address() as { port: number };
  const call = async (path: string, body?: unknown, auth = true) => fetch(`http://127.0.0.1:${address.port}/demo/${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(auth ? { Authorization: "Bearer test" } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { call, dir, close: () => server.close() };
}
describe("persistent demo queue", () => {
  it("requires authentication and an online runner", async () => {
    const f = await fixture(); try {
      expect((await f.call("status", undefined, false)).status).toBe(401);
      expect((await f.call("pay", {})).status).toBe(503);
    } finally { f.close(); }
  });
  it("never reclaims an uncertain job after restart and retains its spending count", async () => {
    const f = await fixture(); let second;
    try {
      await f.call("runner/claim", {});
      const job = await (await f.call("pay", {})).json();
      expect(job.id).toBeTruthy();
      expect((await (await f.call("runner/claim", {})).json()).job.id).toBe(job.id);
      second = await fixture(f.dir);
      expect((await (await second.call("runner/claim", {})).json()).job).toBeNull();
      const s = await (await second.call("status")).json(); expect(s.busy).toBe(true); expect(s.spendingLeft).toBe(39);
      expect((await second.call("pay", {})).status).toBe(429);
    } finally { f.close(); second?.close(); }
  });
  it("pauses after an unsuccessful payment and prevents a competing automatic split", async () => {
    const f = await fixture(); try {
      await f.call("runner/claim", { automaticKeeper: true });
      expect((await f.call("distribute", {})).status).toBe(429);
      const job = await (await f.call("pay", {})).json(); await f.call("runner/claim", {});
      await f.call(`runner/update/${job.id}`, { done: true, ok: false, lines: ["Unknown outcome"] });
      expect((await (await f.call("status")).json()).enabled).toBe(false);
      expect((await f.call("pay", {})).status).toBe(503);
    } finally { f.close(); }
  });
});
