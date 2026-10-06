import { RoundStore, safeId, type RoundConfig } from "@agentfund/cardano-tx";
/** Hosted Atlas reads the same round catalog the dashboard writes, never a separate local copy. */
export function remoteRoundStore(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch) {
  if (!env.FUNDING_API_URL) return new RoundStore();
  const base = new URL(env.FUNDING_API_URL.replace(/\/$/, "") + "/");
  if (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname)) throw new Error("Funding service requires HTTPS");
  if (!env.FUNDING_API_TOKEN) throw new Error("Funding API token required for hosted round catalog");
  return { async round(id: string): Promise<RoundConfig> {
    const r = await fetcher(new URL(`rounds/${safeId(id)}`, base), { headers: { Authorization: `Bearer ${env.FUNDING_API_TOKEN}` }, redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error("Round catalog unavailable");
    return r.json() as Promise<RoundConfig>;
  } };
}
