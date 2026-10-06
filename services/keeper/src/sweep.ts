import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { Address, Assets, Client, TransactionHash, preprod } from "@evolution-sdk/evolution";
import { ATLAS_DEAL, BLOCKFROST_PREPROD_URL, TUSDM_MASUMI_UNIT, TUSDM_X402_UNIT, cardanoscan, formatTusdm } from "@agentfund/shared";
import { buildSplitter } from "@agentfund/cardano-tx";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

/**
 * Moves escrow earnings from the Masumi selling wallet into the splitter.
 *
 * Masumi cannot pay out to a script address — its escrow datum requires a key address as the
 * seller's return address — so collected tUSDM lands in the selling wallet first. This sweep is
 * what puts it under the investor contract. The window between collection and sweep is the trust
 * gap recorded in docs/THREAT_MODEL.md.
 */
const projectId = process.env.BLOCKFROST_PROJECT_ID;
const mnemonic = process.env.MPS_SELLING_WALLET_MNEMONIC;
if (!projectId) throw new Error("BLOCKFROST_PROJECT_ID is not set");
if (!mnemonic) {
  throw new Error(
    "MPS_SELLING_WALLET_MNEMONIC is not set. Export the selling wallet from the payment service's admin dashboard and put it in .env; it is the only key that can move escrow earnings.",
  );
}

const splitter = buildSplitter(ATLAS_DEAL);
const client = Client.make(preprod)
  .withBlockfrost({ baseUrl: BLOCKFROST_PREPROD_URL, projectId })
  .withSeed({ mnemonic, accountIndex: 0 });

const self = await client.address();
const utxos = await client.getUtxos(self);
const held = (unit: string) => utxos.reduce((sum, u) => sum + Assets.getByUnit(u.assets, unit), 0n);
const masumi = held(TUSDM_MASUMI_UNIT);
const x402 = held(TUSDM_X402_UNIT);

if (masumi === 0n && x402 === 0n) {
  console.log(`nothing to sweep from ${Address.toBech32(self)}`);
} else {
  let assets = Assets.zero;
  if (masumi > 0n) assets = Assets.addByHex(assets, TUSDM_MASUMI_UNIT.slice(0, 56), TUSDM_MASUMI_UNIT.slice(56), masumi);
  if (x402 > 0n) assets = Assets.addByHex(assets, TUSDM_X402_UNIT.slice(0, 56), TUSDM_X402_UNIT.slice(56), x402);

  const built = await client
    .newTx()
    .payToAddress({ address: Address.fromBech32(splitter.address), assets })
    .build({ changeAddress: self, autoMinUtxo: true });
  const hash = TransactionHash.toHex(await (await built.sign()).submit());
  console.log(`swept ${formatTusdm(masumi + x402)} tUSDM into the splitter`);
  console.log(cardanoscan.tx(hash));
}
