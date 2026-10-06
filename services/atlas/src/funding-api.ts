import { timingSafeEqual } from "node:crypto";
import { Router, json } from "express";
import { ATLAS_DEAL } from "@agentfund/shared";
import { fundingAction, fundingViews, publicFundingError } from "@agentfund/cardano-tx/funding-service";
export function fundingApi(token = process.env.FUNDING_API_TOKEN) {
  const router = Router();
  let building = false;
  router.use((req, res, next) => {
    if (!token) { res.status(503).json({ error: "Persistent funding API is not configured" }); return; }
    const actual = Buffer.from(req.headers.authorization ?? ""), expected = Buffer.from(`Bearer ${token}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) { res.status(401).json({ error: "Funding service authentication required" }); return; }
    res.setHeader("Cache-Control", "no-store"); next();
  });
  router.get("/", async (_req, res) => {
    try { res.json({ rounds: await fundingViews(), operator: ATLAS_DEAL.atlasAddress }); }
    catch { res.status(503).json({ error: "Cannot read the persistent funding store" }); }
  });
  router.post("/", json({ limit: "70kb" }), async (req, res) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) { res.status(400).json({ error: "Invalid request" }); return; }
    if (building) { res.status(429).json({ error: "Another transaction is being prepared. Try again shortly." }); return; }
    building = true;
    try { res.json(await fundingAction(req.body)); }
    catch (err) { res.status(400).json({ error: publicFundingError(err) }); }
    finally { building = false; }
  });
  return router;
}
