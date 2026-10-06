import type { GatePolicy } from "./policy";

export type AuditorProvider = "openai" | "anthropic" | "mock";

export type AuditorConfig = {
  name: string;
  provider: AuditorProvider;
  url: string;
  model: string;
  secretId: string;
};

const SYSTEM = [
  "You audit a payment an AI buyer agent is about to make to a seller agent on Cardano.",
  'Reply with JSON only, exactly this shape: {"verdict":"allow"|"deny"|"review","confidence":0-100,"reasons":["..."]}.',
  "Use deny when the payment is unsafe, review when you cannot tell, allow only when you are confident it is sound.",
].join(" ");

export const OFFER_AUDIT = (facts: unknown, policy: GatePolicy) =>
  JSON.stringify({
    task: "Check the payment offer's integrity before the buyer pays.",
    rules: [
      `Payments must go to the investor splitter contract ${policy.splitterAddress}, never to another address.`,
      `The amount must not exceed ${policy.maxAmount} base units of an allowed asset.`,
      "The resource must be a due-diligence report from the agent named in the proposal.",
      `The agent's on-chain rating should be at least ${policy.minScore} out of 1000.`,
    ],
    facts,
  });

export const REPORT_AUDIT = (sampleReport: string) =>
  JSON.stringify({
    task: "Grade the craftsmanship of this analyst's report. Decide whether it is worth paying 0.50 tUSDM for.",
    youAreNotAssessing: "the wallet the report describes. Its riskiness is the report's finding, not a defect in the report.",
    allowWhen: [
      "the report states a clear verdict and the facts that led to it",
      "it explains its method and lists the sources it used",
      "its conclusion follows from the facts it presents",
    ],
    denyWhen: ["the report is empty, fabricated, or contradicts its own facts and sources"],
    reviewWhen: ["you genuinely cannot tell whether the report is sound"],
    reminder: "A well-evidenced report saying the wallet is new and risky is excellent work and should be allowed.",
    report: sampleReport.slice(0, 12_000),
  });

export function auditorRequest(a: AuditorConfig, key: string, prompt: string): { headers: Record<string, string>; body: string } {
  if (a.provider === "anthropic") {
    return {
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: a.model, max_tokens: 400, temperature: 0, system: SYSTEM, messages: [{ role: "user", content: prompt }] }),
    };
  }
  return {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: a.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
    }),
  };
}

/** Pulls the model's text out of each provider's response envelope; null when there is none. */
export function auditorText(provider: AuditorProvider, raw: string): string | null {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (provider === "anthropic") {
    const content = body.content as { type?: string; text?: string }[] | undefined;
    return content?.find((c) => c.type === "text")?.text ?? null;
  }
  const choices = body.choices as { message?: { content?: string } }[] | undefined;
  return choices?.[0]?.message?.content ?? null;
}
