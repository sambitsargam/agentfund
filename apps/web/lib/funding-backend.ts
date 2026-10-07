/** Vercel must never attempt to use an ephemeral/local round store. */
export async function remoteFunding(method: "GET" | "POST", body?: unknown, env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): Promise<Response | null> {
  if (!env.FUNDING_API_URL) {
    if (env.VERCEL) return Response.json({ error: "Funding is temporarily unavailable: the persistent funding service is not connected." }, { status: 503 });
    return null;
  }
  const url = new URL(env.FUNDING_API_URL);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) return Response.json({ error: "Funding service requires HTTPS." }, { status: 503 });
  if (!env.FUNDING_API_TOKEN) return Response.json({ error: "Funding service authentication is not configured." }, { status: 503 });
  try {
    const r = await fetcher(url, { method, headers: { Authorization: `Bearer ${env.FUNDING_API_TOKEN}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(55_000) });
    if (!r.headers.get("content-type")?.includes("application/json")) throw new Error("Unexpected service response");
    const data = await r.json();
    return Response.json(data, { status: r.status, headers: { "Cache-Control": "no-store", ...(r.headers.has("retry-after") ? { "Retry-After": r.headers.get("retry-after")! } : {}) } });
  } catch { return Response.json({ error: "Funding service is unreachable. Keep any saved signed transaction and retry confirmation later." }, { status: 503 }); }
}
