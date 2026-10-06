import { createHash, randomBytes } from "node:crypto";
import { readFileSync, existsSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { Client, preprod } from "@evolution-sdk/evolution";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { toClientCardanoSigner } from "@x402/cardano";
import { ExactCardanoScheme } from "@x402/cardano/exact/client";
import { ATLAS_DEAL, BLOCKFROST_PREPROD_URL, classify } from "@agentfund/shared";
import { RoundStore, buildRound, readRound, safeId, roundsDirectory } from "@agentfund/cardano-tx";
import { offerFrom, sameOffer } from "./offer.js";
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
const [id, subject, order = "first"] = process.argv.slice(2);
if (!id || !subject) throw new Error("Usage: round-buy <round-id> <Cardano subject> [unique-order-id]. Reusing an order reuses its signed payment.");
classify(subject); safeId(order);
const projectId = process.env.BLOCKFROST_PROJECT_ID!, mnemonic = process.env.BUYER_MNEMONIC!;
if (!projectId || !mnemonic) throw new Error("Buyer wallet and preprod provider must be configured");
const c = new RoundStore().round(id), script = buildRound(c);
const chain = Client.make(preprod).withBlockfrost({ baseUrl: BLOCKFROST_PREPROD_URL, projectId }).withAddress(ATLAS_DEAL.atlasAddress);
const current = await readRound(chain, c);
if (!["active", "closed"].includes(current.state?.stage ?? "")) throw new Error("Round is not funded; refusing payment");
const base = (process.env.ATLAS_URL ?? "http://localhost:4021").replace(/\/$/, "");
const file = resolve(roundsDirectory(), "purchases", createHash("sha256").update(`${base}:${id}:${subject}:${order}`).digest("hex") + ".json");
mkdirSync(resolve(roundsDirectory(), "purchases"), { recursive: true });
type Purchase = { requestId: string; resource: string; headers?: Record<string, string>; txHash?: string; delivered?: boolean; report?: unknown };
const p: Purchase = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { requestId: randomBytes(32).toString("hex"), resource: "" };
p.resource ||= `${base}/rounds/${id}/report?address=${encodeURIComponent(subject)}&requestId=${p.requestId}`;
const save = () => { writeFileSync(file + ".tmp", JSON.stringify(p, null, 2) + "\n", { mode: 0o600 }); renameSync(file + ".tmp", file); };
if (p.delivered) { console.log(`Already delivered for this order: https://preprod.cardanoscan.io/transaction/${p.txHash}`); process.exit(0); }
const expected = { payTo: script.address, scriptCode: script.code, asset: `${c.terms.policy}.${c.terms.name}`, amount: "500000" };
const client = new x402Client((_v, reqs) => {
  const match = reqs.find(r => sameOffer(offerFrom(r as never), expected));
  if (!match) throw new Error("Payment offer does not match the authenticated funding round and 0.50 tUSDM limit");
  return match;
});
client.register("cardano:*", new ExactCardanoScheme(toClientCardanoSigner({ mnemonic, network: "cardano:preprod", provider: { blockfrost: { baseUrl: BLOCKFROST_PREPROD_URL, projectId } } })));
const http = new x402HTTPClient(client);
if (!p.headers) {
  const offer = await fetch(p.resource, { signal: AbortSignal.timeout(30000) });
  if (offer.status !== 402) throw new Error(`No payable offer (HTTP ${offer.status}); no payment signed`);
  const required = http.getPaymentRequiredResponse(n => offer.headers.get(n));
  const payload = await http.createPaymentPayload(required);
  p.headers = http.encodePaymentSignatureHeader(payload);
  save(); // Exact signed payload is durable BEFORE it can reach a facilitator.
}
console.log("Buying a report through this round's x402 endpoint. This route does not use the separate Chainlink demo gate.");
const response = await fetch(p.resource, { headers: p.headers, signal: AbortSignal.timeout(180000) });
const receipt = http.getPaymentSettleResponse(n => response.headers.get(n));
if (receipt?.transaction) p.txHash = receipt.transaction;
if (!response.ok || !receipt?.success) { save(); throw new Error(`Payment outcome unresolved (HTTP ${response.status}). Rerun the same order only: its exact signed payment is retained.`); }
p.report = await response.json(); p.delivered = true; save();
console.log(`Report delivered. Payment: https://preprod.cardanoscan.io/transaction/${p.txHash}`);
console.log(`Round: ${id}; order: ${order}`);
