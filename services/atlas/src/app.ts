import { createHash } from "node:crypto";
import express, { type Request, type Response } from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactCardanoScheme } from "@x402/cardano/exact/server";
import { USDM_PREPROD_ASSET } from "@x402/cardano";
import {
  ChainClient,
  InvalidInputError,
  NETWORK,
  UpstreamError,
  buildReport,
  classify,
  type Report,
} from "@agentfund/shared";
import type { SplitterScript } from "@agentfund/cardano-tx";
import { receiptDatum, requestIdFor } from "./receipt.js";

export const REPORT_PRICE = "500000"; // 0.50 tUSDM (6 decimals)

export interface AtlasDeps {
  splitter: Pick<SplitterScript, "code" | "hash" | "address">;
  facilitatorUrl: string;
  blockfrostProjectId: string;
  publicUrl: string;
  sampleSubject?: string;
  /** Overridable for tests. */
  resourceServer?: x402ResourceServer;
  chain?: () => ChainClient;
  now?: () => Date;
}

const subjectOf = (req: Request) => String(req.query.address ?? "").trim();
const explicitIdOf = (req: Request) => (typeof req.query.requestId === "string" ? req.query.requestId : undefined);

export function createApp(deps: AtlasDeps) {
  const now = deps.now ?? (() => new Date());
  const newChain = deps.chain ?? (() => new ChainClient({ blockfrostProjectId: deps.blockfrostProjectId }));
  const resourceServer =
    deps.resourceServer ?? new x402ResourceServer(new HTTPFacilitatorClient({ url: deps.facilitatorUrl }));
  if (!deps.resourceServer) resourceServer.register(NETWORK, new ExactCardanoScheme());

  // A paid request served twice (client retry after settlement) returns the same report.
  const served = new Map<string, Report>();
  let latest: Report | undefined;
  let samplePending: Promise<Report> | undefined;

  const app = express();
  app.disable("x-powered-by");

  app.get("/health", (_req, res) => {
    res.json({ ok: true, agent: "atlas", network: NETWORK, splitter: deps.splitter.address });
  });

  // Deterministic liveness check for the CRE rating workflow: every node sends the same challenge.
  app.get("/probe", (req, res) => {
    const challenge = String(req.query.challenge ?? "");
    if (!/^(?:[0-9a-f]{2}){1,64}$/i.test(challenge)) {
      res.status(400).json({ error: "challenge must be 1-64 bytes of hex" });
      return;
    }
    res.json({ challenge, answer: createHash("sha256").update(Buffer.from(challenge, "hex")).digest("hex") });
  });

  app.get("/sample", async (_req, res) => {
    if (!latest && !deps.sampleSubject) {
      res.status(404).json({ error: "no report has been produced yet" });
      return;
    }
    try {
      // A restarted seller still needs real work for the gate to assess before its first purchase.
      if (!latest) {
        samplePending ??= buildReport(deps.sampleSubject!, { chain: newChain(), now: Math.floor(now().getTime() / 1000) });
        latest = await samplePending;
      }
      res.json(latest);
    } catch {
      res.status(503).json({ error: "sample report data is unavailable; retry shortly" });
    } finally {
      samplePending = undefined;
    }
  });

  app.get("/.well-known/x402.json", (_req, res) => {
    res.json({
      x402Version: 2,
      resources: [
        {
          resource: `${deps.publicUrl}/report`,
          type: "http",
          description: "Due-diligence report on a Cardano preprod address, stake address or ADA Handle.",
          price: { amount: REPORT_PRICE, asset: USDM_PREPROD_ASSET, network: NETWORK },
          payTo: deps.splitter.address,
          inputSchema: {
            type: "object",
            required: ["address"],
            properties: {
              address: { type: "string", description: "addr_test1…, stake_test1… or $handle" },
              requestId: { type: "string", description: "Optional 32-byte hex id stored in the payment's receipt datum" },
            },
          },
          outputSchema: { type: "object", description: "Atlas report: subject, facts, score, crossCheck, method, sources" },
        },
      ],
    });
  });

  // Reject unusable input before asking for money.
  app.get("/report", (req, res, next) => {
    try {
      classify(subjectOf(req));
      requestIdFor(subjectOf(req), explicitIdOf(req), now());
      next();
    } catch (err) {
      const message = err instanceof InvalidInputError ? `${err.message} ${err.hint}` : (err as Error).message;
      res.status(400).json({ error: message });
    }
  });

  app.use(
    paymentMiddleware(
      {
        "GET /report": {
          accepts: [
            {
              scheme: "exact",
              network: NETWORK,
              payTo: deps.splitter.address,
              // Price is per request so the receipt datum can carry this request's id.
              price: (ctx) => {
                const params = ctx.adapter.getQueryParams?.() ?? {};
                const address = String(params.address ?? "");
                const explicit = typeof params.requestId === "string" ? params.requestId : undefined;
                return {
                  amount: REPORT_PRICE,
                  // x402 spells assets "policy.name"; this is the same unit as TUSDM_X402_UNIT.
                  asset: USDM_PREPROD_ASSET,
                  extra: { datum: receiptDatum(requestIdFor(address, explicit, now())) },
                };
              },
              extra: {
                assetTransferMethod: "script",
                script: { type: "plutusV3", code: deps.splitter.code },
                // Settle on submission: waiting for a block outlasts the hosted facilitator's
                // gateway timeout, and the buyer would pay without receiving the report.
                confirmationPolicy: { l1Confirmations: 0 },
              },
            },
          ],
          description: "Atlas due-diligence report on a Cardano address (0.50 tUSDM)",
          mimeType: "application/json",
        },
      },
      resourceServer,
    ),
  );

  app.get("/report", async (req: Request, res: Response) => {
    const requestId = requestIdFor(subjectOf(req), explicitIdOf(req), now());
    const cached = served.get(requestId);
    if (cached) {
      res.json({ requestId, report: cached });
      return;
    }
    try {
      const report = await buildReport(subjectOf(req), { chain: newChain(), now: Math.floor(now().getTime() / 1000) });
      served.set(requestId, report);
      latest = report;
      res.json({ requestId, report });
    } catch (err) {
      if (err instanceof InvalidInputError) {
        res.status(400).json({ error: `${err.message} ${err.hint}` });
      } else if (err instanceof UpstreamError) {
        // A non-2xx response keeps the middleware from settling, so the buyer is not charged.
        res.status(503).json({ error: `Chain data provider unavailable (${err.provider}); retry shortly.` });
      } else {
        res.status(500).json({ error: "report failed" });
      }
    }
  });

  return app;
}
