import { remoteFunding } from "../../../lib/funding-backend";
import { ATLAS_DEAL } from "@agentfund/shared";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
let building = false;
export async function GET() {
  try {
    const remote = await remoteFunding("GET");
    if (remote) return remote;
    const { fundingViews } = await import("../../../lib/funding");
    return Response.json({ rounds: await fundingViews(), operator: ATLAS_DEAL.atlasAddress });
  } catch { return Response.json({ error: "Funding data is unavailable. Try again shortly." }, { status: 503 }); }
}
export async function POST(req: Request) {
  if (req.headers.get("origin") !== new URL(req.url).origin) return Response.json({ error: "Use this dashboard to prepare a transaction" }, { status: 403 });
  try {
    const raw = await req.text();
    if (raw.length > 70_000) return Response.json({ error: "Request is too large" }, { status: 413 });
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid request");
    const remote = await remoteFunding("POST", body);
    if (remote) return remote;
    const { fundingAction, publicFundingError } = await import("../../../lib/funding");
    if (building) return Response.json({ error: "Another transaction is being prepared. Try again shortly." }, { status: 429 });
    building = true;
    try { return Response.json(await fundingAction(body)); }
    catch (err) { return Response.json({ error: publicFundingError(err) }, { status: 400 }); }
    finally { building = false; }
  } catch { return Response.json({ error: "Funding service unavailable or request invalid. No replacement transaction was submitted." }, { status: 503 }); }
}
