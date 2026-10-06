import { describe, it, expect, vi } from "vitest";
import { remoteFunding } from "../lib/funding-backend";
describe("hosted funding boundary", () => {
  it("uses local execution only outside Vercel", async () => {
    expect(await remoteFunding("GET", undefined, {})).toBeNull();
    expect((await remoteFunding("GET", undefined, { VERCEL: "1" }))?.status).toBe(503);
  });
  it("never forwards credentials over a remote HTTP connection", async () => {
    const fetcher = vi.fn();
    expect((await remoteFunding("GET", undefined, { FUNDING_API_URL: "http://host.test/funding", FUNDING_API_TOKEN: "test" }, fetcher))?.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("forwards to the configured persistent service and strips its response headers", async () => {
    const f = vi.fn(async () => Response.json({ rounds: [] }, { headers: { "x-secret": "must-not-forward" } }));
    const r = await remoteFunding("POST", { action: "confirm", id: "ticket" }, { FUNDING_API_URL: "https://host.test/funding", FUNDING_API_TOKEN: "test" }, f);
    expect(f).toHaveBeenCalledWith(new URL("https://host.test/funding"), expect.objectContaining({ redirect: "error", headers: { Authorization: "Bearer test", "Content-Type": "application/json" }, body: '{"action":"confirm","id":"ticket"}' }));
    expect(r?.headers.get("x-secret")).toBeNull(); expect(await r?.json()).toEqual({ rounds: [] });
  });
  it("preserves an unknown outcome when the service times out", async () => {
    const r = await remoteFunding("POST", { action: "confirm" }, { FUNDING_API_URL: "https://host.test/funding", FUNDING_API_TOKEN: "test" }, async () => { throw new Error("private headers"); });
    expect(r?.status).toBe(503); expect(JSON.stringify(await r?.json())).not.toContain("private headers");
  });
});
