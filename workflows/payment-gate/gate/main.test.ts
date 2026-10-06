import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildRestrictions, evaluate, type Config, type Http } from "./main";
import { FLAG, decide, parseAuditorOutput, parseProposal } from "./policy";
import { auditorText } from "./auditors";

const config = JSON.parse(readFileSync(new URL("./config.staging.json", import.meta.url), "utf8")) as Config;
const splitterCode = readFileSync(new URL("./testdata/splitter-code.hex", import.meta.url), "utf8").trim();
const NOW = new Date("2026-10-06T05:00:00Z");
const nowSeconds = BigInt(Math.floor(NOW.getTime() / 1000));

const proposal = (overrides: Record<string, string> = {}) =>
  parseProposal(
    JSON.stringify({
      requestId: `0x${"ab".repeat(32)}`,
      agentId: "atlas",
      resource: "http://localhost:4021/report?address=addr_test1qrse",
      payTo: config.policy.splitterAddress,
      asset: config.policy.allowedAssets[0],
      amount: "500000",
      scriptCode: splitterCode,
      ...overrides,
    }),
  );

const chat = (content: string) =>
  new TextEncoder().encode(JSON.stringify({ choices: [{ message: { content } }] }));
const ok = (verdict: string, confidence = 90) => chat(JSON.stringify({ verdict, confidence, reasons: ["checked"] }));

/** Fake HTTP: Blockfrost says the splitter is a live script; auditors answer per name. */
function fakeHttp(answers: { a: Uint8Array; b: Uint8Array }) {
  const calls: string[] = [];
  const http: Http = {
    sendRequest: (_rt, req) => {
      calls.push(req.url);
      let body: Uint8Array;
      if (req.url.includes("/addresses/")) {
        body = new TextEncoder().encode(JSON.stringify({ address: config.policy.splitterAddress, script: true }));
      } else if (req.url.endsWith("/sample")) {
        body = new TextEncoder().encode(JSON.stringify({ score: { verdict: "low" } }));
      } else {
        body = calls.filter((u) => u.includes("/chat/")).length === 1 ? answers.a : answers.b;
      }
      return { result: () => ({ statusCode: 200, body }) };
    },
  };
  return { http, calls };
}

function fakeRuntime() {
  const logs: string[] = [];
  const runtime = {
    config,
    now: () => NOW,
    log: (m: string) => logs.push(m),
    getSecret: ({ id }: { id: string }) => ({ result: () => ({ id, value: `secret-${id}` }) }),
    usingTheDons: () => ({ config }),
  } as never;
  return { runtime, logs };
}

const freshRating = () => ({ score: 385, observedAt: nowSeconds - 60n });

describe("payment gate", () => {
  test("allows a payment into the splitter when the rating is good and both auditors agree", () => {
    const { http, calls } = fakeHttp({ a: ok("allow"), b: ok("allow") });
    const out = evaluate(fakeRuntime().runtime, proposal(), http, freshRating);
    expect(out.verdict).toBe("ALLOW");
    expect(out.flags).toBe(0);
    expect(out.ratingUsed).toBe(385);
    expect(calls.length).toBe(4);
  });

  test("denies a payment to the wrong address without calling the auditors", () => {
    const { http, calls } = fakeHttp({ a: ok("allow"), b: ok("allow") });
    const out = evaluate(
      fakeRuntime().runtime,
      proposal({ payTo: "addr_test1qrseuc9dfg2qdn7vkg35lxnpzjk4y67nemcmmkc2k5t2yk6ddv3uplh7wk4p468pte5fpxgckpmuu2jcuk5vr2qpgz2q7gyegt" }),
      http,
      freshRating,
    );
    expect(out.verdict).toBe("DENY");
    expect(out.flags & FLAG.payToMismatch).toBeTruthy();
    expect(calls.length).toBe(0);
  });

  test("denies an offer whose script is not the deal's splitter", () => {
    const { http } = fakeHttp({ a: ok("allow"), b: ok("allow") });
    const out = evaluate(fakeRuntime().runtime, proposal({ scriptCode: "4e4d01000033222220051200120011" }), http, freshRating);
    expect(out.verdict).toBe("DENY");
    expect(out.reasons).toContain("scriptMismatch");
  });

  test("sends a payment to review when the auditors disagree", () => {
    const { http } = fakeHttp({ a: ok("allow"), b: ok("deny") });
    const out = evaluate(fakeRuntime().runtime, proposal(), http, freshRating);
    expect(out.verdict).toBe("REVIEW");
    expect(out.reasons).toEqual(["auditorObjected"]);
  });

  test("sends a payment to review when the rating is stale", () => {
    const { http } = fakeHttp({ a: ok("allow"), b: ok("allow") });
    const out = evaluate(fakeRuntime().runtime, proposal(), http, () => ({ score: 900, observedAt: nowSeconds - 7200n }));
    expect(out.verdict).toBe("REVIEW");
    expect(out.reasons).toEqual(["ratingStale"]);
  });

  test("treats malformed auditor JSON as review, never allow", () => {
    const { http } = fakeHttp({ a: chat("Sure! It looks fine."), b: ok("allow") });
    const out = evaluate(fakeRuntime().runtime, proposal(), http, freshRating);
    expect(out.verdict).toBe("REVIEW");
    expect(out.reasons).toEqual(["auditorMalformed"]);
  });

  test("a confident-but-low auditor score is not enough to allow", () => {
    const { http } = fakeHttp({ a: ok("allow", 40), b: ok("allow") });
    expect(evaluate(fakeRuntime().runtime, proposal(), http, freshRating).verdict).toBe("REVIEW");
  });
});

describe("policy pieces", () => {
  test("rejects proposals with a malformed request id", () => {
    expect(() => proposal({ requestId: "0x1234" })).toThrow(/requestId/);
  });

  test("auditor output must match the strict shape", () => {
    expect(parseAuditorOutput("a", '{"verdict":"allow","confidence":101,"reasons":[]}').malformed).toBe(true);
    expect(parseAuditorOutput("a", '{"verdict":"maybe","confidence":50,"reasons":[]}').malformed).toBe(true);
    expect(parseAuditorOutput("a", '{"verdict":"allow","confidence":80,"reasons":["ok"]}').malformed).toBe(false);
  });

  test("extracts text from OpenAI and Anthropic envelopes", () => {
    expect(auditorText("openai", JSON.stringify({ choices: [{ message: { content: "x" } }] }))).toBe("x");
    expect(auditorText("anthropic", JSON.stringify({ content: [{ type: "text", text: "y" }] }))).toBe("y");
    expect(auditorText("anthropic", "not json")).toBeNull();
  });

  test("deny flags win over everything else", () => {
    expect(decide(FLAG.payToMismatch | FLAG.auditorUnsure)).toBe("DENY");
    expect(decide(FLAG.auditorUnsure)).toBe("REVIEW");
    expect(decide(0)).toBe("ALLOW");
  });

  test("restricts the enclave to the calls and secrets one decision needs", () => {
    const r = buildRestrictions(config);
    expect(r.capabilities.type).toBe("CAPABILITY_RESTRICTION_TYPE_CLOSED");
    expect(r.capabilities.maxTotalCalls).toBe(7);
    expect(r.secrets.restrictions.map((s) => s.exactSecret.id)).toEqual(["blockfrost_project_id", "auditor_a_key", "auditor_b_key"]);
  });
});
