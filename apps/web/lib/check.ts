import "server-only";
import { ChainClient, InvalidInputError, UpstreamError, buildReport, classify, type Report } from "@agentfund/shared";

const CACHE_MS = 10 * 60_000;
const WINDOW_MS = 60_000;
const PER_IP_PER_MINUTE = 6;
const PER_IP_PER_DAY = 60;

const cache = new Map<string, { at: number; report: Report }>();
const recent = new Map<string, number[]>();
const daily = new Map<string, { day: number; count: number }>();

export class CheckRefused extends Error {}

function allow(ip: string): void {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= PER_IP_PER_MINUTE) throw new CheckRefused("That is a lot of checks at once. Try again in a minute.");
  hits.push(now);
  recent.set(ip, hits);

  const day = Math.floor(now / 86_400_000);
  const d = daily.get(ip);
  const count = d && d.day === day ? d.count + 1 : 1;
  if (count > PER_IP_PER_DAY) throw new CheckRefused("You have used today's free checks. Hire Atlas on Sokosumi for unlimited reports.");
  daily.set(ip, { day, count });
}

export type CheckResult = { ok: true; report: Report; cached: boolean } | { ok: false; message: string; hint?: string };

/** The same report engine Atlas sells, offered free as a preview. */
export async function check(input: string, ip: string): Promise<CheckResult> {
  const subject = input.trim();
  if (!subject) return { ok: false, message: "Enter a Cardano address to check.", hint: "Paste an addr_test1…, stake_test1… or $handle." };

  try {
    classify(subject);
  } catch (err) {
    const e = err as InvalidInputError;
    return { ok: false, message: e.message, hint: e.hint };
  }

  const hit = cache.get(subject);
  if (hit && Date.now() - hit.at < CACHE_MS) return { ok: true, report: hit.report, cached: true };

  allow(ip);
  try {
    const report = await buildReport(subject, { chain: new ChainClient({ blockfrostProjectId: process.env.BLOCKFROST_PROJECT_ID! }) });
    cache.set(subject, { at: Date.now(), report });
    return { ok: true, report, cached: false };
  } catch (err) {
    if (err instanceof InvalidInputError) return { ok: false, message: err.message, hint: err.hint };
    if (err instanceof UpstreamError) {
      return { ok: false, message: "The Cardano data provider did not respond, so Atlas did not guess.", hint: "Please try again in a minute." };
    }
    return { ok: false, message: "Something went wrong running that check.", hint: "Please try again." };
  }
}
