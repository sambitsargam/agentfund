import { remoteDemo } from "../../../../lib/demo-backend";
import { NextResponse } from "next/server";
import { status } from "../../../../lib/jobs";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.DEMO_ACTIONS !== "on") return NextResponse.json({ enabled: false });
  const remote = await remoteDemo("status");
  if (remote) return remote;
  return NextResponse.json({ enabled: true, ...status() });
}
