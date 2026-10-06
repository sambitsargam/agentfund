import { ATLAS_DEAL, TUSDM_MASUMI_UNIT, TUSDM_X402_UNIT } from "@agentfund/shared";

interface BfAmount {
  unit: string;
  quantity: string;
}
export interface BfIo {
  address: string;
  amount: BfAmount[];
  output_index?: number;
  tx_hash?: string;
  inline_datum?: string | null;
  collateral?: boolean;
  reference?: boolean;
}

export interface Payment {
  txHash: string;
  index: number;
  time: number;
  unit: "x402" | "masumi";
  amount: string;
  requestId: string | null;
  splitTx: string | null;
}

export interface Split {
  txHash: string;
  time: number;
  coins: number;
  investor: string;
  atlas: string;
}

export interface CardanoActivity {
  transactions: CardanoTransaction[];
  payments: Payment[];
  splits: Split[];
  earnedX402: string;
  earnedMasumi: string;
  repaidToInvestor: string;
  lockedNow: string;
}

export interface CardanoTransaction {
  tx_hash: string;
  block_time: number;
  utxos: { inputs: BfIo[]; outputs: BfIo[] };
}

export async function allPages<T>(load: (page: number) => Promise<T[]>, pageSize = 100): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const batch = await load(page);
    out.push(...batch);
    if (batch.length < pageSize) return out;
  }
}

const tusdmOf = (amounts: BfAmount[], unit: string) =>
  amounts.filter((a) => a.unit === unit).reduce((s, a) => s + BigInt(a.quantity), 0n);

/** Receipt datum Constr 0 [bytes32 requestId] → requestId. */
function requestIdOf(datum: string | null | undefined): string | null {
  const m = datum?.match(/^d8799f5820([0-9a-f]{64})ff$/);
  return m ? `0x${m[1]}` : null;
}

/** Use the complete history for earnings and net payouts, and live UTxOs for funds still locked. */
export function summarizeCardano(txs: CardanoTransaction[], locked: BfIo[], splitter: string): CardanoActivity {
  const investor = ATLAS_DEAL.investors[0]!.address;

  const payments: Payment[] = [];
  const splits: Split[] = [];
  const spentBy = new Map<string, string>();
  for (const tx of txs) {
    const spent = tx.utxos.inputs.filter((i) => i.address === splitter && !i.collateral && !i.reference);
    if (spent.length > 0) {
      for (const i of spent) spentBy.set(`${i.tx_hash}#${i.output_index}`, tx.tx_hash);
      const paid = (address: string) => {
        const sum = (ios: BfIo[]) => ios.filter((o) => o.address === address && !o.collateral && !o.reference)
          .reduce((s, o) => s + tusdmOf(o.amount, TUSDM_X402_UNIT) + tusdmOf(o.amount, TUSDM_MASUMI_UNIT), 0n);
        return sum(tx.utxos.outputs) - sum(tx.utxos.inputs);
      };
      splits.push({ txHash: tx.tx_hash, time: tx.block_time, coins: spent.length, investor: paid(investor).toString(), atlas: paid(ATLAS_DEAL.atlasAddress).toString() });
    }
    tx.utxos.outputs.forEach((o, index) => {
      if (o.address !== splitter || o.collateral) return;
      const x402 = tusdmOf(o.amount, TUSDM_X402_UNIT);
      const masumi = tusdmOf(o.amount, TUSDM_MASUMI_UNIT);
      if (x402 === 0n && masumi === 0n) return;
      for (const [unit, amount] of [["x402", x402], ["masumi", masumi]] as const) {
        if (amount === 0n) continue;
        payments.push({
          txHash: tx.tx_hash,
          index: o.output_index ?? index,
          time: tx.block_time,
          unit,
          amount: amount.toString(),
          requestId: requestIdOf(o.inline_datum),
          splitTx: null,
        });
      }
    });
  }
  for (const p of payments) p.splitTx = spentBy.get(`${p.txHash}#${p.index}`) ?? null;

  const sum = (xs: string[]) => xs.reduce((s, x) => s + BigInt(x), 0n).toString();
  return {
    transactions: txs,
    payments,
    splits,
    earnedX402: sum(payments.filter((p) => p.unit === "x402").map((p) => p.amount)),
    earnedMasumi: sum(payments.filter((p) => p.unit === "masumi").map((p) => p.amount)),
    repaidToInvestor: sum(splits.map((s) => s.investor)),
    lockedNow: sum(locked.map((o) => (tusdmOf(o.amount, TUSDM_X402_UNIT) + tusdmOf(o.amount, TUSDM_MASUMI_UNIT)).toString())),
  };
}
