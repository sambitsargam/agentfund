import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import express from "express";
import { Client, preprod } from "@evolution-sdk/evolution";
import { fundingApi } from "./funding-api.js";
import { roundRoutes } from "./round-routes.js";
import { ATLAS_DEAL, BLOCKFROST_PREPROD_URL } from "@agentfund/shared";
import { buildSplitter } from "@agentfund/cardano-tx";
import { createApp } from "./app.js";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const port = Number(process.env.PORT ?? process.env.ATLAS_PORT ?? 4021);
const splitter = buildSplitter(ATLAS_DEAL);
const deps = {
  splitter,
  facilitatorUrl: required("FACILITATOR_URL"),
  blockfrostProjectId: required("BLOCKFROST_PROJECT_ID"),
  publicUrl: (process.env.ATLAS_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ""),
  sampleSubject: process.env.ATLAS_SAMPLE_SUBJECT ?? ATLAS_DEAL.atlasAddress,
};
const app = express();
const chain = Client.make(preprod).withBlockfrost({ baseUrl: BLOCKFROST_PREPROD_URL, projectId: required("BLOCKFROST_PROJECT_ID") }).withAddress(ATLAS_DEAL.atlasAddress);
app.use("/funding", fundingApi());
app.use("/rounds", roundRoutes(deps, chain));
app.use(createApp(deps));

app.listen(port, () => {
  console.log(`atlas listening on :${port}, payments to splitter ${splitter.address}`);
});
