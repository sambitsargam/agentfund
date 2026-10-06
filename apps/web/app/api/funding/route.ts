import { NextResponse } from "next/server";
import { fundingViews, prepareFunding, assembleFunding, fundingConfirmation, walletAddress } from "../../../lib/funding";
import { ATLAS_DEAL } from "@agentfund/shared";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
let building = false;
export async function GET() {
  try { return NextResponse.json({ rounds: await fundingViews(), operator: ATLAS_DEAL.atlasAddress }); }
  catch { return NextResponse.json({ error: "Funding data is unavailable. Try again shortly." }, { status: 503 }); }
}
export async function POST(req: Request) {
  if (req.headers.get("origin") !== new URL(req.url).origin) return NextResponse.json({ error: "Use this dashboard to prepare a transaction" }, { status: 403 });
  try {
    const raw = await req.text();
    if (raw.length > 70_000) throw new Error("Request is too large");
    const body = JSON.parse(raw);
    if (body.action === "connect") return NextResponse.json({ address: walletAddress(body.address) });
    if (body.action === "assemble") return NextResponse.json(assembleFunding(body.id, body.witnesses));
    if (body.action === "confirm") return NextResponse.json(await fundingConfirmation(body.id));
    if (!["open", "fund", "distribute", "cancel"].includes(body.action)) throw new Error("Unknown action");
    if (building) return NextResponse.json({ error: "Another transaction is being prepared. Try again shortly." }, { status: 429 });
    building = true;
    try { return NextResponse.json(await prepareFunding(body)); } finally { building = false; }
  } catch (err) {
    // Provider internals may include request headers. Only expose our short, user-facing errors.
    const message = err instanceof Error ? err.message : "";
    const safe = /^(Connect |Only |Invalid |Test round |Operator needs |Round |No confirmed |Investor and |Unknown |Transaction proposal |The unsigned |Request is |Confirmation provider)/.test(message);
    return NextResponse.json({ error: safe ? message.split("\n")[0] : "Could not prepare the transaction. Check test ADA, tUSDM and collateral, then retry." }, { status: 400 });
  }
}
