import { describe, it, expect } from "vitest";
import { readLogRanges, readWithFallback } from "../lib/rpc-logs";
describe("bounded Chainlink history reads", () => {
  it("covers more than 50000 blocks without gaps or duplicate boundary blocks", async () => {
    const ranges: [bigint,bigint][] = [];
    const result = await readLogRanges(100n, 55099n, async (from,to) => { ranges.push([from,to]); return [from]; });
    expect(ranges).toEqual([[100n,10099n],[10100n,20099n],[20100n,30099n],[30100n,40099n],[40100n,50099n],[50100n,55099n]]);
    expect(result).toEqual(ranges.map(r=>r[0]));
  });
  it("uses a working smaller-range provider if the primary fails partway", async () => {
    let calls = 0;
    const result = await readWithFallback([
      () => readLogRanges(0n, 1200n, async from => { if (from === 1000n) throw new Error("quota"); return [from]; }, 1000n),
      () => readLogRanges(0n, 1200n, async (from,to) => { calls++; expect(to-from).toBeLessThan(500n); return [from]; }, 500n),
    ]);
    expect(result).toEqual([0n,500n,1000n]); expect(calls).toBe(3);
  });
  it("never presents an incomplete query or total provider outage as empty history", async () => {
    await expect(readWithFallback([async () => { throw new Error("secret RPC URL"); }, async () => { throw new Error("failed"); }])).rejects.toThrow("temporarily unavailable");
    expect(await readLogRanges(5n,4n,async()=>[1])).toEqual([]);
  });
});
