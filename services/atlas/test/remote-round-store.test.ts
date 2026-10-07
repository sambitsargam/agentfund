import { describe, it, expect, vi } from "vitest";
import { remoteRoundStore } from "../src/remote-round-store.js";
describe("hosted round catalog", () => {
  it("refuses insecure remote transport", () => {
    expect(() => remoteRoundStore({ FUNDING_API_URL: "http://example.com/funding", FUNDING_API_TOKEN: "secret" })).toThrow("HTTPS");
  });
  it("authenticates the catalog request and refuses redirects", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "a".repeat(56) })));
    const store = remoteRoundStore({ FUNDING_API_URL: "https://example.com/funding", FUNDING_API_TOKEN: "secret" }, fetcher);
    expect((await store.round("a".repeat(56))).id).toBe("a".repeat(56));
    expect(String(fetcher.mock.calls[0]![0])).toBe(`https://example.com/funding/rounds/${"a".repeat(56)}`);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ headers: { Authorization: "Bearer secret" }, redirect: "error" });
  });
  it("rejects unavailable catalogs without disclosing response bodies", async () => {
    const store = remoteRoundStore({ FUNDING_API_URL: "https://example.com/funding", FUNDING_API_TOKEN: "secret" }, vi.fn().mockResolvedValue(new Response("private backend error", { status: 500 })));
    await expect(store.round("a".repeat(56))).rejects.toThrow("Round catalog unavailable");
  });
});
