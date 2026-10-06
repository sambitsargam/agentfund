import { remoteDemo } from "../../../../lib/demo-backend";
import { NextResponse } from "next/server";
import { Refused, start, type ActionName } from "../../../../lib/jobs";

export const dynamic = "force-dynamic";

const ACTIONS: ActionName[] = ["pay", "tamper", "distribute", "rate"];

export async function POST(_req: Request, { params }: { params: Promise<{ action: string }> }) {
  if (_req.headers.get("origin") !== new URL(_req.url).origin) return NextResponse.json({ error: "Same-origin request required" }, { status: 403 });
  if (process.env.DEMO_ACTIONS !== "on") {
    return NextResponse.json({ error: "Live actions are switched off on this deployment." }, { status: 503 });
  }
  const { action } = await params;
  if (!ACTIONS.includes(action as ActionName)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 404 });
  }
  const remote = await remoteDemo(action, "POST");
  if (remote) return remote;
  try {
    const job = start(action as ActionName);
    return NextResponse.json({ id: job.id, lines: job.lines });
  } catch (err) {
    if (err instanceof Refused) {
      return NextResponse.json({ error: err.message, retryAfter: err.retryAfter }, { status: 429 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
