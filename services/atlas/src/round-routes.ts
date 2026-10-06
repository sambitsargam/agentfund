import { Router, type RequestHandler } from "express";
import { ATLAS_DEAL, TUSDM_X402_POLICY, TUSDM_ASSET_NAME } from "@agentfund/shared";
import { buildRound, readRound, type RoundConfig, type RoundClient, RoundStore } from "@agentfund/cardano-tx";
import { createApp, type AtlasDeps } from "./app.js";

/** A dedicated revenue stream per round. The old /report endpoint keeps its existing deal. */
export function roundRoutes(deps: AtlasDeps, client: RoundClient, db: { round(id: string): RoundConfig | Promise<RoundConfig> } = new RoundStore()) {
  const router = Router();
  const apps = new Map<string, ReturnType<typeof createApp>>();
  const handler: RequestHandler = async (req, res, next) => {
    try {
      let c: RoundConfig;
      try { c = await db.round(String(req.params.id)); } catch { res.status(404).json({ error: "Unknown funding round" }); return; }
      if (c.id !== String(req.params.id) || buildRound(c).hash !== c.id || c.agent !== "atlas" || c.service !== "recipient-check" || c.terms.operator !== ATLAS_DEAL.atlasAddress || c.terms.policy !== TUSDM_X402_POLICY || c.terms.name !== TUSDM_ASSET_NAME) {
        res.status(409).json({ error: "Round does not bind this Atlas service and payment asset" }); return;
      }
      const { state } = await readRound(client, c);
      if (state?.stage !== "active" && state?.stage !== "closed") {
        res.status(409).json({ error: "This round is not funded. No payment requested." }); return;
      }
      let app = apps.get(c.id);
      if (!app) {
        app = createApp({ ...deps, splitter: buildRound(c), publicUrl: `${deps.publicUrl}/rounds/${c.id}` });
        apps.set(c.id, app);
      }
      app(req, res, next);
    } catch { res.status(503).json({ error: "Round state unavailable. No payment requested; retry later." }); }
  };
  router.use("/:id", handler);
  return router;
}
