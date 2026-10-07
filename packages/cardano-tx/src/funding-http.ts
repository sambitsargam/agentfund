import { fundingQuota, FundingLimited } from "./funding-guards.js";
import { timingSafeEqual } from "node:crypto";
import { Router, json } from "express";
import { RoundStore } from "./round-store.js";
import { ATLAS_DEAL } from "@agentfund/shared";
import { fundingAction, fundingViews, publicFundingError } from "./funding-service.js";
export function fundingApi(token = process.env.FUNDING_API_TOKEN) {
  const router = Router();
  let building = false;
  router.use((req, res, next) => {
    if (!token) { res.status(503).json({ error: "Persistent funding API is not configured" }); return; }
    const actual = Buffer.from(req.headers.authorization ?? ""), expected = Buffer.from(`Bearer ${token}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) { res.status(401).json({ error: "Funding service authentication required" }); return; }
    res.setHeader("Cache-Control", "no-store"); next();
  });
  router.get("/rounds/:id", (req, res) => {
    try { res.json(new RoundStore().round(String(req.params.id))); }
    catch { res.status(404).json({ error: "Round not found" }); }
  });
  let cached: { value: unknown; until: number } | undefined;
  let reading: Promise<unknown> | undefined;
  router.get("/", async (_req, res) => {
    try {
      fundingQuota(new RoundStore().dir, "read");
      if (cached && cached.until > Date.now()) { res.json(cached.value); return; }
      if (!reading) reading = fundingViews().then(rounds => {
        const value = { rounds, operator: ATLAS_DEAL.atlasAddress }; cached = { value, until: Date.now() + 10000 }; return value;
      }).finally(() => { reading = undefined; });
      res.json(await reading);
    } catch (err) {
      if (err instanceof FundingLimited) res.setHeader("Retry-After", err.retryAfter);
      res.status(err instanceof FundingLimited ? 429 : 503).json({ error: err instanceof FundingLimited ? err.message : "Cannot read the persistent funding store" });
    }
  });
  router.post("/", json({ limit: "70kb" }), async (req, res) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) { res.status(400).json({ error: "Invalid request" }); return; }
    if (building) { res.status(429).json({ error: "Another transaction is being prepared. Try again shortly." }); return; }
    building = true;
    try { res.json(await fundingAction(req.body)); }
    catch (err) {
      if (err instanceof FundingLimited) res.setHeader("Retry-After", err.retryAfter);
      res.status(err instanceof FundingLimited ? 429 : 400).json({ error: err instanceof FundingLimited ? err.message : publicFundingError(err), ...(err instanceof FundingLimited ? { retryAfter: err.retryAfter } : {}) });
    }
    finally { building = false; }
  });
  return router;
}
