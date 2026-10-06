import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import {
  Address,
  Assets,
  Client,
  TransactionHash,
  preprod,
} from "@evolution-sdk/evolution";
import {
  ATLAS_ROUND_TERMS,
  BLOCKFROST_PREPROD_URL,
  cardanoscan,
  formatTusdm,
} from "@agentfund/shared";
import {
  buildRound,
  nextPayout,
  prepareRoundDistribute,
  prepareRoundFund,
  prepareRoundOpen,
  readRound,
  type RoundConfig,
} from "@agentfund/cardano-tx";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const dir = fileURLToPath(
  new URL("../../../docs/evidence/funding/", import.meta.url),
);
mkdirSync(dir, { recursive: true });
const file = `${dir}/round.json`;

type Event = { action: string; txHash: string; at: string; note: string };
type Record = {
  id: string;
  terms: typeof ATLAS_ROUND_TERMS;
  seed?: { txHash: string; index: number };
  scriptHash?: string;
  address?: string;
  /** Set immediately before a submission and cleared after, so a crash cannot be retried blindly. */
  pending?: { action: string; at: string };
  events: Event[];
};

const blank: Record = {
  id: "atlas-round-1",
  terms: ATLAS_ROUND_TERMS,
  events: [],
};
const record: Record = existsSync(file)
  ? (JSON.parse(readFileSync(file, "utf8")) as Record)
  : blank;
if (JSON.stringify(record.terms) !== JSON.stringify(ATLAS_ROUND_TERMS))
  throw new Error(
    "Saved round terms differ from the configured ones; open a new round rather than rewriting these",
  );
const save = () => {
  writeFileSync(`${file}.tmp`, JSON.stringify(record, null, 2) + "\n");
  renameSync(`${file}.tmp`, file);
};

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

function wallet(which: "operator" | "investor") {
  const mnemonic =
    which === "operator"
      ? process.env.ATLAS_MNEMONIC
      : process.env.INVESTOR_MNEMONIC;
  if (!mnemonic)
    throw new Error(
      `${which === "operator" ? "ATLAS_MNEMONIC" : "INVESTOR_MNEMONIC"} must be set for this step`,
    );
  return Client.make(preprod)
    .withBlockfrost({ baseUrl: BLOCKFROST_PREPROD_URL, projectId })
    .withSeed({ mnemonic, accountIndex: 0 });
}

function configOf(): RoundConfig {
  if (!record.seed) throw new Error("Round has not been opened yet");
  return {
    id: record.id,
    agent: "atlas",
    service: "recipient-check",
    terms: record.terms,
    seed: record.seed,
  };
}

/** Records the submission as uncertain first; a hash we never saw is worse than a retry we refuse. */
async function submit(action: string, note: string, built: any) {
  if (record.pending)
    throw new Error(
      `A ${record.pending.action} submission from ${record.pending.at} was never confirmed; run \`status\` and inspect the address before retrying`,
    );
  record.pending = { action, at: new Date().toISOString() };
  save();
  const txHash = TransactionHash.toHex(await (await built.sign()).submit());
  record.events.push({ action, txHash, at: new Date().toISOString(), note });
  delete record.pending;
  save();
  console.log(`${action}: ${cardanoscan.tx(txHash)}`);
  return txHash;
}

async function confirm(txHash: string) {
  for (let i = 0; i < 60; i++) {
    try {
      const tx = await bf(`/txs/${txHash}`);
      if (tx?.block_height)
        return console.log(`confirmed in block ${tx.block_height}`);
    } catch {
      /* not yet on chain */
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(
    "Not confirmed within five minutes; inspect before acting on it",
  );
}

const amount = (n: bigint) => `${formatTusdm(n)} tUSDM`;
const action = process.argv[2] ?? "status";

if (action === "status") {
  console.log(
    `round ${record.id}: capital ${amount(BigInt(record.terms.capital))}, ${record.terms.bps / 100}% share, cap ${amount(BigInt(record.terms.cap))}`,
  );
  if (record.pending)
    console.log(
      `UNCONFIRMED ${record.pending.action} submitted ${record.pending.at}`,
    );
  if (!record.seed) console.log("not yet opened");
  else {
    console.log(`address ${record.address}`);
    const { state, receipts } = await readRound(wallet("operator"), configOf());
    const revenue = receipts.reduce(
      (n, u) =>
        n + Assets.getByUnit(u.assets, record.terms.policy + record.terms.name),
      0n,
    );
    console.log(
      state
        ? `state ${state.stage}${"paid" in state ? ` · earned ${amount(BigInt(state.earned))} · repaid ${amount(BigInt(state.paid))}` : ""}`
        : "no authenticated state coin",
    );
    console.log(
      `waiting revenue ${amount(revenue)} in ${receipts.length} coin(s)`,
    );
  }
  for (const e of record.events)
    console.log(`  ${e.at} ${e.action} ${e.txHash} — ${e.note}`);
} else if (action === "verify") {
  // Re-derives every net flow from Blockfrost's own UTxO data rather than from our event log,
  // so the published evidence does not depend on this runner having told the truth.
  if (!record.address) throw new Error("Round has not been opened yet");
  const governed = record.terms.policy + record.terms.name;
  const netOf = (tx: any, address: string) => {
    const side = (list: any[]) =>
      list
        .filter((u: any) => u.address === address)
        .reduce(
          (n: bigint, u: any) =>
            n +
            BigInt(
              u.amount.find((a: any) => a.unit === governed)?.quantity ?? 0,
            ),
          0n,
        );
    return side(tx.outputs) - side(tx.inputs);
  };
  const investorAddress = (await readRound(wallet("operator"), configOf()))
    .state;
  const investor =
    investorAddress && "investor" in investorAddress
      ? investorAddress.investor
      : null;
  if (!investor)
    throw new Error("Round has no recorded investor to verify against");
  const steps = [];
  for (const e of record.events) {
    const [tx, utxos] = await Promise.all([
      bf(`/txs/${e.txHash}`),
      bf(`/txs/${e.txHash}/utxos`),
    ]);
    steps.push({
      action: e.action,
      txHash: e.txHash,
      block: tx.block_height,
      note: e.note,
      investorNet: String(netOf(utxos, investor)),
      operatorNet: String(netOf(utxos, record.terms.operator)),
    });
  }
  const repaid = steps
    .filter((x) => x.action === "distribute")
    .reduce((n, x) => n + BigInt(x.investorNet), 0n);
  if (repaid > BigInt(record.terms.cap))
    throw new Error(
      `Repayments of ${repaid} exceed the cap of ${record.terms.cap}`,
    );
  const out = {
    network: "Cardano preprod",
    verifiedAt: new Date().toISOString(),
    round: record.id,
    address: record.address,
    scriptHash: record.scriptHash,
    terms: record.terms,
    investor,
    capitalPaid: steps
      .filter((x) => x.action === "fund")
      .reduce((n, x) => n - BigInt(x.investorNet), 0n)
      .toString(),
    totalRepaid: repaid.toString(),
    capReached: repaid === BigInt(record.terms.cap),
    scope:
      "Net governed-asset flows per transaction, read back from Blockfrost. Lovelace, fees and min-UTxO are excluded.",
    steps,
  };
  writeFileSync(
    `${dir}/../../samples/round-verification.json`,
    JSON.stringify(out, null, 2) + "\n",
  );
  console.log(
    `capital ${amount(BigInt(out.capitalPaid))} in, repaid ${amount(repaid)} of a ${amount(BigInt(record.terms.cap))} cap, cap reached: ${out.capReached}`,
  );
  console.log("wrote docs/samples/round-verification.json");
} else if (action === "resolve") {
  // An uncertain submission is resolved by the chain, not by trusting our own log: any
  // transaction at the round address that we never recorded is adopted, and only a clean
  // address clears the flag.
  if (!record.pending) throw new Error("Nothing is pending");
  if (!record.address) throw new Error("Round has not been opened yet");
  const seen = new Set(record.events.map((e) => e.txHash));
  const onChain: { tx_hash: string }[] = await bf(
    `/addresses/${record.address}/transactions?order=desc&count=20`,
  );
  const unrecorded = onChain.map((t) => t.tx_hash).filter((h) => !seen.has(h));
  if (unrecorded.length) {
    for (const txHash of unrecorded)
      record.events.push({
        action: record.pending.action,
        txHash,
        at: new Date().toISOString(),
        note: "Adopted after an uncertain submission",
      });
    console.log(
      `adopted ${unrecorded.length} unrecorded transaction(s): ${unrecorded.join(", ")}`,
    );
  } else {
    console.log(
      `no transaction from the uncertain ${record.pending.action} reached the chain; it is safe to retry`,
    );
  }
  delete record.pending;
  save();
} else if (action === "open") {
  if (record.events.some((e) => e.action === "open"))
    throw new Error("This round is already open");
  const client = wallet("operator");
  if (Address.toBech32(await client.address()) !== record.terms.operator)
    throw new Error(
      "ATLAS_MNEMONIC does not control the round's operator address",
    );
  // The seed makes the address unique, so a cancelled round can never be re-opened at it. Take the
  // largest pure-ADA coin: a smaller one is likelier to be spent by something else mid-build.
  const coins = await client.getUtxos(
    Address.fromBech32(record.terms.operator),
  );
  const seedCoin = coins
    .filter(
      (u) =>
        Object.keys(u.assets).length === 1 &&
        Assets.getByUnit(u.assets, "lovelace") >= 10_000_000n,
    )
    .sort((a, b) =>
      Number(
        Assets.getByUnit(b.assets, "lovelace") -
          Assets.getByUnit(a.assets, "lovelace"),
      ),
    )[0];
  if (!seedCoin)
    throw new Error(
      "No pure-ADA operator coin of at least 10 ADA to use as the seed",
    );
  const seed = {
    txHash: TransactionHash.toHex(seedCoin.transactionId),
    index: Number(seedCoin.index),
  };
  const candidate: RoundConfig = {
    id: record.id,
    agent: "atlas",
    service: "recipient-check",
    terms: record.terms,
    seed,
  };
  // Build before persisting: the address depends on the seed, so a seed that turns out to be
  // already spent must never be recorded as this round's identity.
  const built = await prepareRoundOpen(client, candidate);
  const script = buildRound(candidate);
  record.seed = seed;
  record.scriptHash = script.hash;
  record.address = script.address;
  save();
  const hash = await submit("open", "Marker minted, round offered", built);
  await confirm(hash);
} else if (action === "fund") {
  const client = wallet("investor");
  const investor = Address.toBech32(await client.address());
  const hash = await submit(
    "fund",
    `Investor paid ${amount(BigInt(record.terms.capital))}; share activated`,
    await prepareRoundFund(client, configOf(), investor),
  );
  await confirm(hash);
} else if (action === "revenue") {
  const units = BigInt(process.argv[3] ?? "500000");
  const client = wallet("operator");
  if (!record.address) throw new Error("Round has not been opened yet");
  // A receipt coin must hold the governed asset and nothing else but ADA.
  const hash = await submit(
    "revenue",
    `${amount(units)} of agent revenue paid into the round`,
    await client
      .newTx()
      .payToAddress({
        address: Address.fromBech32(record.address!),
        assets: Assets.addByHex(
          Assets.zero,
          record.terms.policy,
          record.terms.name,
          units,
        ),
      })
      .build({ autoMinUtxo: true }),
  );
  await confirm(hash);
} else if (action === "distribute") {
  const client = wallet("operator");
  const { state, receipts } = await readRound(client, configOf());
  if (!state) throw new Error("No authenticated state coin");
  const revenue = receipts.reduce(
    (n, u) =>
      n + Assets.getByUnit(u.assets, record.terms.policy + record.terms.name),
    0n,
  );
  const plan = nextPayout(state, record.terms, revenue);
  console.log(
    `revenue ${amount(revenue)} → investor ${amount(plan.investor)}, operator ${amount(plan.operator)}, state ${plan.state.stage}`,
  );
  const hash = await submit(
    "distribute",
    `Investor repaid ${amount(plan.investor)}; round ${plan.state.stage}`,
    (await prepareRoundDistribute(client, configOf())).built,
  );
  await confirm(hash);
} else
  throw new Error(
    "Use status, resolve, open, fund, revenue [units] or distribute",
  );
