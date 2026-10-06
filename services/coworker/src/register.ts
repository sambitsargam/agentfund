/**
 * Registers Atlas in the Masumi registry under the funded selling wallet, with the
 * Standard access model for Sokosumi paid Tasks. x402 reports use their own
 * payment offer and do not require X402 registry registration.
 *
 *   npm run register -w @agentfund/coworker          # register (idempotent)
 *   npm run register -w @agentfund/coworker -- check # poll until confirmed
 *   npm run register -w @agentfund/coworker -- url https://atlas.example.com
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
config({ path: fileURLToPath(new URL("../.env.local", import.meta.url)) });

const MPS = (process.env.MPS_URL ?? "http://127.0.0.1:3012").replace(/\/$/, "");
const ADMIN = process.env.MPS_ADMIN_KEY;
const STATE = process.env.COWORKER_DATA_DIR
  ? `${process.env.COWORKER_DATA_DIR}/registration.json`
  : fileURLToPath(new URL("../data/registration.json", import.meta.url));

interface State {
  sellingWalletId: string;
  agentIdentifier?: string;
  supportedPaymentSourceIndex: number;
  payoutAddress: string;
  registrationId?: string;
  state?: string;
  x402ResourcesUrl: string;
  requestedAt?: string;
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  if (!ADMIN) throw new Error("MPS_ADMIN_KEY is not set");
  const res = await fetch(MPS + "/api/v1" + path, {
    method: body ? "POST" : "GET",
    headers: { token: ADMIN, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  const json = JSON.parse(text) as { status?: string; data?: T };
  if (!res.ok || json.status !== "success") throw new Error(`MPS ${path} → ${res.status} ${text.slice(0, 400)}`);
  return json.data as T;
}

const read = (): State | undefined => (existsSync(STATE) ? (JSON.parse(readFileSync(STATE, "utf8")) as State) : undefined);
const save = (s: State) => {
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(s, null, 2));
  return s;
};

interface Wallet {
  id: string;
  walletVkey: string;
  walletAddress: string;
  collectionAddress: string | null;
}
interface Source {
  id: string;
  network: string;
  paymentSourceType: string;
  smartContractAddress: string;
  policyId: string;
}

/** The payment-source listing does not carry wallets, so the id comes from env or prior state. */
async function sellingWallet(): Promise<Wallet & { id: string }> {
  const id = process.env.MPS_SELLING_WALLET_ID ?? read()?.sellingWalletId;
  if (!id) throw new Error("set MPS_SELLING_WALLET_ID to the seeded selling wallet's id");
  const w = await api<Omit<Wallet, "id">>(`/wallet?walletType=Selling&id=${encodeURIComponent(id)}`);
  if (!w.walletVkey) throw new Error(`wallet ${id} has no verification key`);
  return { ...w, id };
}

async function register(resourcesUrl: string) {
  const prior = read();
  if (prior?.registrationId) {
    console.log(`already registered (${prior.registrationId}); run with "check" to poll, or "url <https://…>" to update it`);
    return;
  }
  const sources = await api<{ PaymentSources: Source[] }>("/payment-source?take=10");
  const source = sources.PaymentSources.find((s) => s.network === "Preprod" && s.paymentSourceType === "Web3CardanoV2");
  if (!source) throw new Error("no Preprod Web3CardanoV2 payment source");
  const wallet = await sellingWallet();

  // Sokosumi Task purchases go through the Standard access model, which is what Masumi's own
  // reference implementation registers; x402 payments do not need the registry at all, because
  // the facilitator verifies the script address from the 402 itself.
  const standard = (process.env.MASUMI_ACCESS_MODEL ?? "Standard") === "Standard";
  const body = {
    network: "Preprod",
    type: standard ? "Standard" : "X402",
    sellingWalletVkey: wallet.walletVkey,
    ...(standard ? { apiBaseUrl: resourcesUrl.replace(/\/\.well-known\/x402\.json$/, "") } : { x402ResourcesUrl: resourcesUrl }),
    supportedPaymentSources: [
      {
        chain: "Cardano",
        network: "Preprod",
        paymentSourceType: "Web3CardanoV2",
        address: source.smartContractAddress,
        pricing: { pricingType: "Dynamic" },
      },
    ],
    name: "Atlas — Cardano wallet check",
    description:
      "Check any Cardano wallet before you pay it. Atlas reads the wallet's public history and returns a plain-language risk verdict with the facts, the method and links to the public record. Built for treasury, payments, grants and OTC teams.",
    Tags: ["due-diligence", "cardano", "risk", "payments", "treasury"],
    Capability: { name: "atlas-wallet-check", version: "1" },
    Author: { name: "AgentFund" },
    ExampleOutputs: [
      {
        name: "Wallet check: medium risk",
        url: "https://github.com/sambitsargam/agentfund/blob/main/docs/samples/task-result-event-workspace.md",
        mimeType: "text/markdown",
      },
    ],
  };

  // Save the intent before the write, so an uncertain outcome is inspected rather than retried blindly.
  save({
    sellingWalletId: wallet.id,
    supportedPaymentSourceIndex: 0,
    payoutAddress: wallet.collectionAddress ?? wallet.walletAddress,
    x402ResourcesUrl: resourcesUrl,
    requestedAt: new Date().toISOString(),
  });
  const result = await api<{ id: string; state?: string }>("/registry", body);
  save({ ...read()!, registrationId: result.id, state: result.state });
  console.log(`registration submitted: ${result.id} (${result.state ?? "pending"})`);
}

async function check() {
  const s = read();
  if (!s?.registrationId) throw new Error("nothing registered yet");
  const list = await api<{ Assets: { id: string; state: string; agentIdentifier?: string | null; error?: unknown }[] }>(
    "/registry?network=Preprod&filterPaymentSourceType=Web3CardanoV2&limit=100",
  );
  const mine = list.Assets.find((a) => a.id === s.registrationId);
  if (!mine) {
    console.log("registration not visible in the registry yet");
    return;
  }
  save({ ...s, state: mine.state, ...(mine.agentIdentifier ? { agentIdentifier: mine.agentIdentifier } : {}) });
  console.log(`state: ${mine.state}${mine.agentIdentifier ? ` · agentIdentifier ${mine.agentIdentifier}` : ""}`);
  if (mine.error) console.log("error:", JSON.stringify(mine.error).slice(0, 300));
}

const [command, value] = process.argv.slice(2);
if (command === "check") await check();
else if (command === "url") {
  if (!value?.startsWith("https://")) throw new Error("usage: register url https://…/.well-known/x402.json");
  const s = read();
  if (!s?.agentIdentifier) throw new Error("register and wait for confirmation first");
  await api("/registry/update", { network: "Preprod", agentIdentifier: s.agentIdentifier, x402ResourcesUrl: value });
  save({ ...s, x402ResourcesUrl: value });
  console.log(`registration now points at ${value}`);
} else {
  await register(process.env.ATLAS_PUBLIC_URL ? `${process.env.ATLAS_PUBLIC_URL.replace(/\/$/, "")}/.well-known/x402.json` : "http://localhost:4021/.well-known/x402.json");
}
