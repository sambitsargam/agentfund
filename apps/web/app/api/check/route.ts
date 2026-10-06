import { NextResponse } from "next/server";
import { CheckRefused, check } from "../../../lib/check";
import { lookupPublicReputation } from "@agentfund/shared";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  let address = "";
  try {
    ({ address } = (await req.json()) as { address?: string } as { address: string });
  } catch {
    return NextResponse.json({ ok: false, message: "Send an address to check." }, { status: 400 });
  }
  try {
    if (typeof address === "string" && /^addr1[02-9ac-hj-np-z]{50,110}$/.test(address.trim())) {
      return NextResponse.json({ ok: true, reputation: lookupPublicReputation(address.trim()) });
    }
    return NextResponse.json(await check(address ?? "", ip));
  } catch (err) {
    if (err instanceof CheckRefused) return NextResponse.json({ ok: false, message: err.message }, { status: 429 });
    return NextResponse.json({ ok: false, message: "Something went wrong running that check." }, { status: 500 });
  }
}
