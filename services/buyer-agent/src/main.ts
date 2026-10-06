import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { Address, Assets, Client, TransactionHash, preprod } from "@evolution-sdk/evolution";
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { toClientCardanoSigner } from "@x402/cardano";
import { ExactCardanoScheme } from "@x402/cardano/exact/client";
import type { Hex } from "viem";
import { ATLAS_DEAL, BLOCKFROST_PREPROD_URL, TUSDM_ASSET_NAME, TUSDM_X402_POLICY, basescan, cardanoscan } from "@agentfund/shared";
import { Budget, fetchOffer, offerFrom, sameOffer, tampered, type Offer, type PaymentProposal } from "./offer.js";
import { PaymentGate } from "./gate.js";
import { Journal } from "./journal.js";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const env = (name: string, fallback?: string) => {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`${name} is not set`);
  return v;
};

const ATLAS_URL = env("ATLAS_URL", "http://localhost:4021").replace(/\/$/, "");
const BUDGET = BigInt(env("BUYER_BUDGET", "5000000")); // 5 tUSDM per run
const journal = new Journal(fileURLToPath(new URL("../data/journal.jsonl", import.meta.url)));
const gate = new PaymentGate({
  registryAddress: env("REGISTRY_ADDRESS", "0xee171354e30f24428eEaAaDA952eEC7479b08131") as Hex,
  rpcUrl: env("BASE_SEPOLIA_RPC", "https://sepolia.base.org"),
  workflowProject: fileURLToPath(new URL("../../../workflows/payment-gate", import.meta.url)),
  creBin: env("CRE_BIN", `${homedir()}/.cre/bin/cre`),
});

function signer() {
  return toClientCardanoSigner({
    mnemonic: env("BUYER_MNEMONIC"),
    network: "cardano:preprod",
    provider: { blockfrost: { baseUrl: BLOCKFROST_PREPROD_URL, projectId: env("BLOCKFROST_PROJECT_ID") } },
  });
}

/** Pays the resource, but only if the 402 still matches the offer the gate approved. */
async function payApproved(resource: string, approved: Offer) {
  const client = new x402Client((_version, requirements) => {
    const match = requirements.find((r) => sameOffer(offerFrom(r as never), approved));
    if (!match) throw new Error("the offer changed after the gate approved it; refusing to pay");
    return match;
  });
  client.register("cardano:*", new ExactCardanoScheme(signer()));
  const pay = wrapFetchWithPayment(fetch, client);

  // Coin selection reads the wallet from Blockfrost before anything is signed, so a failed read is safe to retry.
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await pay(resource);
      const receipt = new x402HTTPClient(client).getPaymentSettleResponse((n) => res.headers.get(n));
      return { res, receipt };
    } catch (err) {
      const message = (err as Error).message ?? "";
      if (attempt < 3 && /getUtxos failed/.test(message)) {
        await new Promise((r) => setTimeout(r, 5_000 * attempt));
        continue;
      }
      throw err;
    }
  }
}

async function buy(subject: string, tamper: boolean) {
  const budget = new Budget(BUDGET);
  const requestId = `0x${randomBytes(32).toString("hex")}` as Hex;
  const resource = `${ATLAS_URL}/report?address=${encodeURIComponent(subject)}&requestId=${requestId.slice(2)}`;

  const offer = await fetchOffer(resource);
  const honest: PaymentProposal = { requestId, agentId: ATLAS_DEAL.agentId, resource, ...offer };
  const proposal = tamper ? tampered(honest, ATLAS_DEAL.investors[0]!.address) : honest;
  journal.write({ type: "offer", requestId, resource, payTo: proposal.payTo, amount: proposal.amount, asset: proposal.asset, tampered: tamper });
  console.log(`offer: ${Number(offer.amount) / 1e6} tUSDM to ${offer.payTo}${tamper ? " (tampered: asking the gate to approve a different payTo)" : ""}`);

  budget.reserve(BigInt(proposal.amount));
  console.log("asking the Chainlink payment gate…");
  const submitted = await gate.submit(proposal);
  const decision = await gate.waitForDecision(requestId);
  journal.write({ type: "gate", requestId, verdict: decision.verdict, riskFlags: decision.riskFlags, ratingUsed: decision.ratingUsed, txHash: submitted.txHash });
  console.log(`gate: ${decision.verdict} (flags ${decision.riskFlags}, rating ${decision.ratingUsed})${submitted.txHash ? ` ${basescan.tx(submitted.txHash)}` : ""}`);

  if (decision.verdict !== "ALLOW") {
    budget.release(BigInt(proposal.amount));
    journal.write({ type: "skipped", requestId, reason: `gate said ${decision.verdict}` });
    console.log("not paying.");
    return;
  }

  const started = Date.now();
  const { res, receipt } = await payApproved(resource, proposal);
  if (!res.ok || !receipt?.success) {
    const message = `payment failed: HTTP ${res.status} ${receipt?.errorReason ?? ""}`;
    journal.write({ type: "error", requestId, message });
    throw new Error(message);
  }
  const seconds = (Date.now() - started) / 1000;
  journal.write({ type: "paid", requestId, txHash: receipt.transaction, seconds });
  const body = (await res.json()) as { report?: { score?: { verdict?: string; risk?: number } } };
  console.log(`paid in ${seconds.toFixed(1)} s: ${cardanoscan.tx(receipt.transaction)}`);
  console.log(`report verdict: ${body.report?.score?.verdict} (${body.report?.score?.risk}/100)`);
}

/** Splits the buyer's funds into separate coins so back-to-back payments do not race for one UTxO. */
async function fanout(count: number) {
  const client = Client.make(preprod)
    .withBlockfrost({ baseUrl: BLOCKFROST_PREPROD_URL, projectId: env("BLOCKFROST_PROJECT_ID") })
    .withSeed({ mnemonic: env("BUYER_MNEMONIC"), accountIndex: 0 });
  const self = await client.address();
  let tx = client.newTx();
  for (let i = 0; i < count; i++) {
    tx = tx.payToAddress({
      address: self,
      assets: Assets.addByHex(Assets.fromLovelace(5_000_000n), TUSDM_X402_POLICY, TUSDM_ASSET_NAME, 20_000_000n),
    });
  }
  const built = await tx.build({ changeAddress: self });
  const hash = TransactionHash.toHex(await (await built.sign()).submit());
  console.log(`fanned out ${count} coins of 5 tADA + 20 tUSDM to ${Address.toBech32(self)}`);
  console.log(cardanoscan.tx(hash));
}

const [command, ...rest] = process.argv.slice(2);
if (command === "buy") {
  const subject = rest.find((a) => !a.startsWith("--"));
  if (!subject) throw new Error("usage: buy <address|stake address|$handle> [--tamper]");
  await buy(subject, rest.includes("--tamper"));
} else if (command === "fanout") {
  await fanout(Number(rest[0] ?? 10));
} else {
  console.error("usage: main.ts buy <subject> [--tamper] | fanout [count]");
  process.exit(1);
}
