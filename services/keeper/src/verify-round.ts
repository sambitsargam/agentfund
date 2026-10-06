import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { Client, preprod } from "@evolution-sdk/evolution";
import { BLOCKFROST_PREPROD_URL, formatTusdm } from "@agentfund/shared";
import { RoundStore, buildRound } from "@agentfund/cardano-tx";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const id = process.argv[2];
if (!id) throw new Error("Usage: verify-round <roundId>");
const projectId = process.env.BLOCKFROST_PROJECT_ID;
if (!projectId) throw new Error("BLOCKFROST_PROJECT_ID must be set");

const bf = async (path: string) => {
  const res = await fetch(BLOCKFROST_PREPROD_URL + path, {
    headers: { project_id: projectId },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Blockfrost ${path} → ${res.status}`);
  return res.json() as Promise<any>;
};

const config_ = new RoundStore().round(id);
const script = buildRound(config_);
const unit = config_.terms.policy + config_.terms.name;
const governed = (list: any[], address: string) =>
  list
    .filter((u) => u.address === address && !u.collateral)
    .reduce(
      (n: bigint, u: any) =>
        n + BigInt(u.amount.find((a: any) => a.unit === unit)?.quantity ?? 0),
      0n,
    );

/** Net movement of the governed asset, read back from the chain rather than from our own log. */
const net = (utxos: any, address: string) =>
  governed(utxos.outputs, address) - governed(utxos.inputs, address);

const client = Client.make(preprod)
  .withBlockfrost({ baseUrl: BLOCKFROST_PREPROD_URL, projectId })
  .withAddress(config_.terms.operator);
const investor = await (async () => {
  const { readRound } = await import("@agentfund/cardano-tx");
  const r = await readRound(client, config_);
  if (r.state && "investor" in r.state)
    return {
      address: r.state.investor,
      stage: r.state.stage,
      earned: r.state.earned,
      paid: r.state.paid,
    };
  throw new Error("Round has no investor on chain yet");
})();

const list: { tx_hash: string }[] = await bf(
  `/addresses/${script.address}/transactions?order=asc&count=50`,
);
const steps = [];
for (const { tx_hash } of list) {
  const [tx, utxos] = await Promise.all([
    bf(`/txs/${tx_hash}`),
    bf(`/txs/${tx_hash}/utxos`),
  ]);
  const intoRound = net(utxos, script.address);
  const payers = [
    ...new Set(
      utxos.inputs
        .filter((i: any) => !i.collateral && i.address !== script.address)
        .map((i: any) => i.address),
    ),
  ];
  steps.push({
    txHash: tx_hash,
    block: tx.block_height,
    kind: intoRound > 0n ? "revenue" : intoRound < 0n ? "payout" : "state",
    investorNet: String(net(utxos, investor.address)),
    operatorNet: String(net(utxos, config_.terms.operator)),
    // A customer paying the round directly is the point: the money never passes through Atlas.
    paidBy: intoRound > 0n ? payers : undefined,
  });
}

const repaid = steps.reduce(
  (n, s) => (s.kind === "payout" ? n + BigInt(s.investorNet) : n),
  0n,
);
const capital = steps.reduce(
  (n, s) =>
    s.kind === "state" && BigInt(s.investorNet) < 0n
      ? n - BigInt(s.investorNet)
      : n,
  0n,
);
if (repaid > BigInt(config_.terms.cap))
  throw new Error(
    `Repayments of ${repaid} exceed the cap of ${config_.terms.cap}`,
  );

const out = {
  network: "Cardano preprod",
  verifiedAt: new Date().toISOString(),
  round: id,
  address: script.address,
  terms: config_.terms,
  investor: investor.address,
  stage: investor.stage,
  capitalPaid: String(capital),
  totalRepaid: String(repaid),
  capReached: repaid === BigInt(config_.terms.cap),
  scope:
    "Net governed-asset flows per transaction, read back from Blockfrost. Lovelace, fees and min-UTxO are excluded.",
  steps,
};
const file = fileURLToPath(
  new URL(
    `../../../docs/samples/round-${id.slice(0, 8)}-verification.json`,
    import.meta.url,
  ),
);
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(
  `${investor.stage}: capital ${formatTusdm(capital)} in, repaid ${formatTusdm(repaid)} of a ${formatTusdm(BigInt(config_.terms.cap))} cap (cap reached: ${out.capReached})`,
);
console.log(`wrote ${file.split("/agentfund/").pop()}`);
