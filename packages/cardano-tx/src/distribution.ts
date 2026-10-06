import { Address, Assets, Data, PlutusV3, TransactionHash, type UTxO } from "@evolution-sdk/evolution";
import { SPLIT_UNITS, type SplitterScript } from "./splitter.js";

/** Safe batch size: a 10-input batch measured at ~82% of preprod's per-tx memory limit. */
export const MAX_BATCH = 8;
const MAX_BPS = 10_000n;

export interface Payout {
  keyHash: string;
  address: string;
  /** Quantity per split unit, keyed by "policy.name". */
  amounts: Record<string, bigint>;
}

export interface DistributionPlan {
  inputs: { txHash: string; index: number }[];
  totals: Record<string, bigint>;
  investors: Payout[];
  atlas: Payout;
}

const unitKey = (u: { policy: string; name: string }) => `${u.policy}.${u.name}`;

export interface LockedCoin {
  txHash: string;
  index: number;
  /** Quantity per split unit, keyed by "policy.name"; missing means zero. */
  amounts: Record<string, bigint>;
}

/**
 * Mirrors the on-chain rule: each investor gets floor(total * bps / 10000) of every unit,
 * Atlas gets the remainder, so the transaction built from this plan always validates.
 */
export function planDistribution(
  coins: LockedCoin[],
  splitter: SplitterScript,
  addresses: { atlas: string; investors: string[] },
): DistributionPlan {
  if (coins.length === 0) throw new Error("nothing to distribute");
  if (coins.length > MAX_BATCH) throw new Error(`batch of ${coins.length} exceeds the safe limit of ${MAX_BATCH}`);

  const totals: Record<string, bigint> = {};
  for (const unit of SPLIT_UNITS) {
    totals[unitKey(unit)] = coins.reduce((sum, c) => sum + (c.amounts[unitKey(unit)] ?? 0n), 0n);
  }

  const investors = splitter.investors.map((inv, i) => ({
    keyHash: inv.keyHash,
    address: addresses.investors[i]!,
    amounts: Object.fromEntries(Object.entries(totals).map(([k, t]) => [k, (t * BigInt(inv.bps)) / MAX_BPS])),
  }));
  const atlas = {
    keyHash: splitter.atlasKeyHash,
    address: addresses.atlas,
    amounts: Object.fromEntries(
      Object.entries(totals).map(([k, t]) => [k, t - investors.reduce((s, inv) => s + inv.amounts[k]!, 0n)]),
    ),
  };
  return { inputs: coins.map(({ txHash, index }) => ({ txHash, index })), totals, investors, atlas };
}

export function lockedCoinOf(utxo: UTxO.UTxO): LockedCoin {
  const amounts: Record<string, bigint> = {};
  for (const unit of SPLIT_UNITS) {
    amounts[unitKey(unit)] = Assets.getByUnit(utxo.assets, unit.policy + unit.name);
  }
  return { txHash: TransactionHash.toHex(utxo.transactionId), index: Number(utxo.index), amounts };
}

function payoutAssets(amounts: Record<string, bigint>): Assets.Assets | null {
  let assets = Assets.zero;
  let any = false;
  for (const [key, qty] of Object.entries(amounts)) {
    if (qty <= 0n) continue;
    const [policy, name] = key.split(".") as [string, string];
    assets = Assets.addByHex(assets, policy, name, qty);
    any = true;
  }
  return any ? assets : null;
}

/** Minimal surface of the Evolution client used here, so tests can stub it. */
export interface DistributionClient {
  getUtxos(address: Address.Address): Promise<UTxO.UTxO[]>;
  newTx(): any;
}

export interface DistributionResult {
  plan: DistributionPlan;
  txHash: string;
}

/**
 * Spends up to MAX_BATCH splitter coins in one transaction, paying investors and Atlas.
 * The client's wallet (Atlas) funds the fee, min-ADA and collateral; leftover ADA returns to it.
 */
export async function distribute(
  client: DistributionClient,
  splitter: SplitterScript,
  addresses: { atlas: string; investors: string[] },
): Promise<DistributionResult | null> {
  const utxos = (await client.getUtxos(Address.fromBech32(splitter.address))).filter((u) => {
    const coin = lockedCoinOf(u);
    return Object.values(coin.amounts).some((q) => q > 0n);
  });
  if (utxos.length === 0) return null;
  const batch = utxos.slice(0, MAX_BATCH);
  const plan = planDistribution(batch.map(lockedCoinOf), splitter, addresses);

  let tx = client
    .newTx()
    .collectFrom({ inputs: batch, redeemer: Data.constr(0n, []) })
    .attachScript({ script: new PlutusV3.PlutusV3({ bytes: Buffer.from(splitter.code, "hex") }) });
  for (const payout of [...plan.investors, plan.atlas]) {
    const assets = payoutAssets(payout.amounts);
    if (assets) tx = tx.payToAddress({ address: Address.fromBech32(payout.address), assets });
  }
  const built = await tx.build({ changeAddress: Address.fromBech32(addresses.atlas), autoMinUtxo: true });
  const signed = await built.sign();
  const txHash = TransactionHash.toHex(await signed.submit());
  return { plan, txHash };
}


