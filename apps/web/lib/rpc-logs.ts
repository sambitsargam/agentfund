/** Read the entire requested interval without gaps, overlaps, or partial-success results. */
export async function readLogRanges<T>(from: bigint, to: bigint, query: (from: bigint, to: bigint) => Promise<T[]>, chunk = 10000n): Promise<T[]> {
  if (chunk <= 0n) throw new Error("Invalid RPC block range");
  const ranges: [bigint, bigint][] = [];
  for (let start = from; start <= to; start += chunk) ranges.push([start, start + chunk - 1n > to ? to : start + chunk - 1n]);
  const results: T[][] = [];
  // Bound provider load; preserve chain ordering independent of response order.
  for (let i = 0; i < ranges.length; i += 4) results.push(...await Promise.all(ranges.slice(i, i + 4).map(([start, end]) => query(start, end))));
  return results.flat();
}
export async function readWithFallback<T>(readers: (() => Promise<T>)[]): Promise<T> {
  for (const read of readers) { try { return await read(); } catch { /* Try the next independent provider. */ } }
  throw new Error("Chainlink history is temporarily unavailable from the RPC providers. Please retry shortly.");
}
