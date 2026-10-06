import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { ATLAS_DEAL } from "@agentfund/shared";
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
const app = createApp({
  splitter,
  facilitatorUrl: required("FACILITATOR_URL"),
  blockfrostProjectId: required("BLOCKFROST_PROJECT_ID"),
  publicUrl: (process.env.ATLAS_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ""),
  sampleSubject: process.env.ATLAS_SAMPLE_SUBJECT ?? ATLAS_DEAL.atlasAddress,
});

app.listen(port, () => {
  console.log(`atlas listening on :${port}, payments to splitter ${splitter.address}`);
});
