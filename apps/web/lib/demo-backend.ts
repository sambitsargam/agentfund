export async function remoteDemo(path: string, method: "GET" | "POST" = "GET"): Promise<Response | null> {
  if (!process.env.DEMO_API_URL) return process.env.VERCEL ? Response.json({ enabled: false, error: "Live runner is not connected." }, { status: 503 }) : null;
  const base = new URL(process.env.DEMO_API_URL.replace(/\/$/, "") + "/");
  if (base.protocol !== "https:" || !process.env.DEMO_API_TOKEN) return Response.json({ enabled: false, error: "Live runner configuration is incomplete." }, { status: 503 });
  try {
    const r = await fetch(new URL(path, base), { method, headers: { Authorization: `Bearer ${process.env.DEMO_API_TOKEN}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
    return Response.json(await r.json(), { status: r.status, headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ enabled: false, error: "Cannot reach the runner. Check the current run before trying again." }, { status: 503 }); }
}
