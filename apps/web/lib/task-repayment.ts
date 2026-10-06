import { ATLAS_DEAL, TUSDM_MASUMI_UNIT } from "@agentfund/shared";
import type { BfIo, CardanoTransaction } from "./cardano-activity";

export interface RepaymentPath {
  collectionIndex: number;
  sweepTx: string;
  sweepIndex: number;
  swept: string;
  splitTx: string | null;
  investorPaid: string | null;
  atlasPaid: string | null;
}

export interface TaskRepayment {
  status: "unverified" | "awaiting-sweep" | "locked" | "distributed";
  collected: string | null;
  paths: RepaymentPath[];
  note: string;
}

const amount = (io: BfIo) => io.amount.reduce((sum, a) => sum + (a.unit === TUSDM_MASUMI_UNIT ? BigInt(a.quantity) : 0n), 0n);
const spendInputs = (tx: CardanoTransaction) => tx.utxos.inputs.filter(i => !i.collateral && !i.reference);
const net = (tx: CardanoTransaction, address: string) =>
  tx.utxos.outputs.filter(o => o.address === address && !o.collateral).reduce((sum, o) => sum + amount(o), 0n)
  - spendInputs(tx).filter(i => i.address === address).reduce((sum, i) => sum + amount(i), 0n);

/** A path requires a spent collection output, then that exact splitter output spent in a paying batch. */
export function traceTaskRepayment(
  collectionHash: string,
  collection: { inputs: BfIo[]; outputs: BfIo[] },
  transactions: CardanoTransaction[],
  seller: string,
  splitter: string,
  expectedCollected: string | null,
): TaskRepayment {
  const receipt: CardanoTransaction = { tx_hash: collectionHash, block_time: 0, utxos: collection };
  const collected = net(receipt, seller);
  const outputs = collection.outputs.filter(o => o.address === seller && !o.collateral && amount(o) > 0n);
  const unknown = (note: string): TaskRepayment => ({ status: "unverified", collected: null, paths: [], note });
  if (collected <= 0n || (expectedCollected !== null && collected !== BigInt(expectedCollected))) {
    return unknown("The wallet receipt does not match the Task's recorded collection. Repayment is not verified.");
  }
  const paths: RepaymentPath[] = [];
  let linked = 0;
  for (const output of outputs) {
    if (output.output_index === undefined) return unknown("The collection output reference is unavailable.");
    const sweeps = transactions.filter(tx => spendInputs(tx).some(i => i.tx_hash === collectionHash && i.output_index === output.output_index && i.address === seller));
    if (sweeps.length > 1) return unknown("Conflicting spend references; refresh the chain data.");
    const sweep = sweeps[0];
    if (!sweep) continue;
    const received = sweep.utxos.outputs.filter(o => o.address === splitter && !o.collateral && amount(o) > 0n);
    // Never attribute a partial/diverted wallet spend to the Task's full receipt.
    if (received.reduce((sum, o) => sum + amount(o), 0n) < amount(output)) continue;
    if (received.some(o => o.output_index === undefined)) return unknown("The contract output reference is unavailable.");
    linked++;
    for (const coin of received) {
      const split = transactions.find(tx => spendInputs(tx).some(i => i.tx_hash === sweep.tx_hash && i.output_index === coin.output_index && i.address === splitter));
      let investorPaid: string | null = null;
      let atlasPaid: string | null = null;
      if (split) {
        const total = spendInputs(split).filter(i => i.address === splitter).reduce((sum, i) => sum + amount(i), 0n);
        const investorDue = total * BigInt(ATLAS_DEAL.investors[0]!.bps) / 10_000n;
        const investor = net(split, ATLAS_DEAL.investors[0]!.address);
        const atlas = net(split, ATLAS_DEAL.atlasAddress);
        if (investor >= investorDue && atlas >= total - investorDue && investorDue > 0n) {
          investorPaid = investor.toString();
          atlasPaid = atlas.toString();
        }
      }
      paths.push({ collectionIndex: output.output_index, sweepTx: sweep.tx_hash, sweepIndex: coin.output_index!, swept: amount(coin).toString(), splitTx: split?.tx_hash ?? null, investorPaid, atlasPaid });
    }
  }
  if (linked !== outputs.length) {
    return { status: "awaiting-sweep", collected: collected.toString(), paths, note: "Collection confirmed. A complete direct sweep is not yet verified; funds may still be in the operator wallet or may have moved through another transaction." };
  }
  const paid = paths.length > 0 && paths.every(p => p.investorPaid !== null);
  return { status: paid ? "distributed" : "locked", collected: collected.toString(), paths, note: paid
    ? "Collection outputs link to the contract and a confirmed paying batch. Amounts below are batch totals, not an allocation to this Task alone."
    : "The collection links to the contract. Investor repayment is not yet verified; the contract coin may be unspent or its spend still needs verification." };
}
