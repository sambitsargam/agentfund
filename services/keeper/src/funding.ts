import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { Address, Assets, Client, TransactionHash, preprod } from "@evolution-sdk/evolution";
import { ATLAS_DEAL, BLOCKFROST_PREPROD_URL, cardanoscan } from "@agentfund/shared";
import { fundingMatches } from "./funding-proof.js";
import { buildSplitter } from "@agentfund/cardano-tx";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
const dir = fileURLToPath(new URL("../../../docs/evidence/funding/", import.meta.url));
mkdirSync(dir, { recursive: true });
const file = `${dir}/seed-round.json`;
const splitter = buildSplitter(ATLAS_DEAL);
const terms = {
  version: 1, network: "preprod", agentId: ATLAS_DEAL.agentId,
  capitalLovelace: "2000000", capitalRecipient: ATLAS_DEAL.atlasAddress,
  investor: ATLAS_DEAL.investors[0]!, splitter: splitter.address,
  scriptHash: splitter.hash,
  terms: "2 test ADA for the existing 10% share of governed earnings reaching this contract. No principal guarantee, repayment cap or transferable share token. Masumi earnings depend on the operator sweep.",
};
const termsHash = createHash("sha256").update(JSON.stringify(terms)).digest("hex");
type Record = { terms: typeof terms; termsHash: string; state: string; txHash?: string; fundedAt?: string; verifiedAt?: string };
let record: Record = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { terms, termsHash, state: "proposed" };
if (record.termsHash !== termsHash) throw new Error("Existing funding terms differ; create a separate round rather than rewriting them");
const save = () => { writeFileSync(`${file}.tmp`, JSON.stringify(record, null, 2) + "\n"); renameSync(`${file}.tmp`, file); };
const action = process.argv[2] ?? "review";
if (action === "review") { save(); console.log(JSON.stringify(record, null, 2)); }
else if (action === "fund") {
  if (record.state !== "proposed") throw new Error("Funding was already attempted; verify the saved transaction before retrying");
  const projectId = process.env.BLOCKFROST_PROJECT_ID;
  const mnemonic = process.env.INVESTOR_MNEMONIC;
  if (!projectId || !mnemonic) throw new Error("Local investor mnemonic and Blockfrost credentials required");
  const client = Client.make(preprod).withBlockfrost({ baseUrl: BLOCKFROST_PREPROD_URL, projectId }).withSeed({ mnemonic, accountIndex: 0 });
  if (Address.toBech32(await client.address()) !== terms.investor.address) throw new Error("Investor wallet does not match the immutable share allocation");
  const built = await client.newTx().payToAddress({ address: Address.fromBech32(terms.capitalRecipient), assets: Assets.fromLovelace(2_000_000n) })
    .attachMetadata({ label: 674n, metadata: ["AgentFund seed round", termsHash] }).build({ autoMinUtxo: true });
  // Record ambiguity before submission: a crash cannot silently fund the round twice.
  record.state = "submission-uncertain"; save();
  record.txHash = TransactionHash.toHex(await (await built.sign()).submit());
  record.state = "submitted"; save();
  console.log(cardanoscan.tx(record.txHash));
} else if (action === "verify") {
  if (!record.txHash) throw new Error("No saved funding transaction; investigate an uncertain submission before retrying");
  const get = async (path: string) => {
    const res = await fetch(BLOCKFROST_PREPROD_URL + path, { headers: { project_id: process.env.BLOCKFROST_PROJECT_ID! }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Funding evidence unavailable (${res.status})`);
    return res.json();
  };
  const [tx, utxos, metadata] = await Promise.all([get(`/txs/${record.txHash}`), get(`/txs/${record.txHash}/utxos`), get(`/txs/${record.txHash}/metadata`)]);
  if (!fundingMatches({ tx, utxos, metadata }, { investor: terms.investor.address, recipient: terms.capitalRecipient, lovelace: BigInt(terms.capitalLovelace), digest: termsHash })) throw new Error("Funding transaction does not satisfy the reviewed terms");
  record.state = "funded"; record.fundedAt = new Date(tx.block_time * 1000).toISOString(); record.verifiedAt = new Date().toISOString(); save();
  console.log("Verified: 2 test ADA received by Atlas, investor 10% terms bound in transaction metadata");
} else throw new Error("Use review, fund or verify");
