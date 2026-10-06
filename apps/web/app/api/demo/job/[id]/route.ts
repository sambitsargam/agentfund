import { NextResponse } from "next/server";
import { getJob } from "../../../../../lib/jobs";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "That run has expired." }, { status: 404 });
  return NextResponse.json({ id: job.id, action: job.action, lines: job.lines, done: job.finishedAt !== undefined, ok: job.ok ?? null });
}
