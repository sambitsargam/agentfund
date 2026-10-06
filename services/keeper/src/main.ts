import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { Address, Client, preprod } from "@evolution-sdk/evolution";
import { ATLAS_DEAL, BLOCKFROST_PREPROD_URL, cardanoscan, formatTusdm } from "@agentfund/shared";
import { buildSplitter, distribute } from "@agentfund/cardano-tx";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const projectId = process.env.BLOCKFROST_PROJECT_ID;
const mnemonic = process.env.ATLAS_MNEMONIC;
if (!projectId || !mnemonic) throw new Error("BLOCKFROST_PROJECT_ID and ATLAS_MNEMONIC must be set");

const splitter = buildSplitter(ATLAS_DEAL);
const client = Client.make(preprod)
  .withBlockfrost({ baseUrl: BLOCKFROST_PREPROD_URL, projectId })
  .withSeed({ mnemonic, accountIndex: 0 });

// Refuse to sign with a wallet that is not the deal's Atlas.
const wallet = Address.toBech32(await client.address());
if (wallet !== ATLAS_DEAL.atlasAddress) throw new Error("ATLAS_MNEMONIC does not control the deal's Atlas address");

const result = await distribute(client, splitter, {
  atlas: ATLAS_DEAL.atlasAddress,
  investors: ATLAS_DEAL.investors.map((i) => i.address),
});

if (!result) {
  console.log(`nothing to distribute at ${splitter.address}`);
} else {
  const fmt = (amounts: Record<string, bigint>) =>
    Object.entries(amounts).filter(([, q]) => q > 0n).map(([k, q]) => `${formatTusdm(q)} ${k.startsWith("16a5") ? "tUSDM(Masumi)" : "tUSDM"}`).join(" + ") || "0";
  console.log(`distributed ${result.plan.inputs.length} coin(s)`);
  ATLAS_DEAL.investors.forEach((inv, i) => console.log(`  ${inv.name}: ${fmt(result.plan.investors[i]!.amounts)}`));
  console.log(`  Atlas: ${fmt(result.plan.atlas.amounts)}`);
  console.log(`tx ${result.txHash}`);
  console.log(cardanoscan.tx(result.txHash));
}
