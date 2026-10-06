import { remoteDemo } from "../../../../../lib/demo-backend";
import { NextResponse } from "next/server";
import { getJob } from "../../../../../lib/jobs";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const remote = await remoteDemo(`job/${encodeURIComponent(id)}`);
  if (remote) return remote;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "That run has expired." }, { status: 404 });
  return NextResponse.json({ id: job.id, action: job.action, lines: job.lines, done: job.finishedAt !== undefined, ok: job.ok ?? null });
}
