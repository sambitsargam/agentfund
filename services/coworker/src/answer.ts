import { createHash } from "node:crypto";
import {
  ChainClient,
  InvalidInputError,
  UpstreamError,
  buildReport,
  classify,
  extractCandidate,
  renderInputHelpMarkdown,
  renderReportMarkdown,
  renderUpstreamFailureMarkdown,
} from "@agentfund/shared";

/** Masumi hashes the exact UTF-8 bytes of the Task input and of the delivered result. */
export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export const MAX_RESULT_BYTES = 1024 * 1024;

export type Prepared =
  | { ok: true; subject: string }
  | { ok: false; markdown: string };

/** Decides before any payment whether the Task contains something Atlas can check. */
export function prepare(input: string): Prepared {
  const candidate = extractCandidate(input);
  try {
    if (!candidate) throw new InvalidInputError("No Cardano address or handle was found in the request.", "");
    classify(candidate);
    return { ok: true, subject: candidate };
  } catch (err) {
    if (err instanceof InvalidInputError) {
      const hinted = err.hint
        ? err
        : new InvalidInputError(err.message, "Send one Cardano preprod payment address (addr_test1…), stake address (stake_test1…) or ADA Handle ($name).");
      return { ok: false, markdown: renderInputHelpMarkdown(hinted) };
    }
    throw err;
  }
}

export type Answer = { markdown: string; delivered: boolean };

/** Runs Atlas's report. `delivered` is false when the answer explains a failure instead of a report. */
export async function answer(subject: string, blockfrostProjectId: string): Promise<Answer> {
  try {
    const report = await buildReport(subject, { chain: new ChainClient({ blockfrostProjectId }) });
    const markdown = renderReportMarkdown(report);
    if (Buffer.byteLength(markdown, "utf8") > MAX_RESULT_BYTES) throw new Error("report exceeds the 1 MiB result limit");
    return { markdown, delivered: true };
  } catch (err) {
    if (err instanceof InvalidInputError) return { markdown: renderInputHelpMarkdown(err), delivered: false };
    if (err instanceof UpstreamError) return { markdown: renderUpstreamFailureMarkdown(err.provider), delivered: false };
    throw err;
  }
}
