import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { ChainClient } from "@agentfund/shared";
import { ATLAS_DEAL } from "@agentfund/shared";
import { buildSplitter } from "@agentfund/cardano-tx";
import { createApp } from "../src/app.js";
import { receiptDatum, requestIdFor } from "../src/receipt.js";

const ADDR = "addr_test1qrseuc9dfg2qdn7vkg35lxnpzjk4y67nemcmmkc2k5t2yk6ddv3uplh7wk4p468pte5fpxgckpmuu2jcuk5vr2qpgz2q7gyegt";
const splitter = buildSplitter(ATLAS_DEAL);

// Local facilitator stand-in: advertises the Cardano exact scheme so the 402 can be built.
const facilitatorFetch = async (url: string) => {
  if (url.endsWith("/supported")) {
    return new Response(
      JSON.stringify({
        kinds: [{ x402Version: 2, scheme: "exact", network: "cardano:preprod", extra: { assetTransferMethods: ["default", "script"], l1Confirmations: { minimum: 0, maximum: 20 } } }],
        extensions: [],
        signers: {},
      }),
      { status: 200 },
    );
  }
  return new Response("{}", { status: 500 });
};

function app() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    return url.startsWith("http://facilitator.test") ? facilitatorFetch(url) : realFetch(input, init);
  }) as typeof fetch;
  return createApp({
    splitter,
    facilitatorUrl: "http://facilitator.test",
    blockfrostProjectId: "test",
    publicUrl: "https://atlas.test",
    chain: () => new ChainClient({ blockfrostProjectId: "test", fetch: async () => new Response("{}", { status: 404 }) }),
    now: () => new Date("2026-10-06T04:00:00Z"),
  });
}

describe("receipt", () => {
  it("derives a stable id per subject and day, and accepts an explicit one", () => {
    const day = new Date("2026-10-06T04:00:00Z");
    expect(requestIdFor(ADDR, undefined, day)).toBe(requestIdFor(ADDR, undefined, new Date("2026-10-06T23:00:00Z")));
    expect(requestIdFor(ADDR, undefined, day)).not.toBe(requestIdFor(ADDR, undefined, new Date("2026-10-07T00:00:00Z")));
    expect(requestIdFor(ADDR, "AB".repeat(32))).toBe("ab".repeat(32));
    expect(() => requestIdFor(ADDR, "xyz")).toThrow();
  });

  it("encodes the request id as Constr 0 [bytes]", () => {
    expect(receiptDatum("00".repeat(32))).toBe("d8799f5820" + "00".repeat(32) + "ff");
  });
});

describe("atlas http", () => {
  it("answers the probe deterministically", async () => {
    const res = await request(app()).get("/probe?challenge=00ff");
    expect(res.status).toBe(200);
    expect(res.body.answer).toBe(createHash("sha256").update(Buffer.from("00ff", "hex")).digest("hex"));
    const again = await request(app()).get("/probe?challenge=00ff");
    expect(again.body.answer).toBe(res.body.answer);
  });

  it("rejects a bad address before asking for payment", async () => {
    const res = await request(app()).get("/report?address=hello");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/addr_test1/);
  });

  it("asks for 0.50 tUSDM into the splitter with the script method and a receipt datum", async () => {
    const res = await request(app()).get(`/report?address=${ADDR}`);
    expect(res.status).toBe(402);
    const required = JSON.parse(Buffer.from(String(res.headers["payment-required"]), "base64").toString());
    const offer = required.accepts[0];
    expect(offer.payTo).toBe(splitter.address);
    expect(offer.amount).toBe("500000");
    expect(offer.asset).toBe("e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9.0014df10745553444d");
    expect(offer.extra.assetTransferMethod).toBe("script");
    expect(offer.extra.script).toEqual({ type: "plutusV3", code: splitter.code });
    expect(offer.extra.datum).toBe(receiptDatum(requestIdFor(ADDR, undefined, new Date("2026-10-06T04:00:00Z"))));
  });

  it("publishes an x402 resource manifest for the Masumi registry", async () => {
    const res = await request(app()).get("/.well-known/x402.json");
    expect(res.body.resources[0].resource).toBe("https://atlas.test/report");
    expect(res.body.resources[0].type).toBe("http");
  });
});
