import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Address, Assets, Data, InlineDatum, KeyHash, PlutusV3, ScriptHash, TransactionHash, UPLC, type UTxO } from "@evolution-sdk/evolution";
import { scriptHashOf, unwrapCborBytes } from "./splitter.js";

export interface RoundTerms { operator: string; policy: string; name: string; capital: string; bps: number; cap: string }
export interface RoundConfig { id: string; agent: string; service: "recipient-check" | "invoice-reconciliation"; terms: RoundTerms; seed: { txHash: string; index: number } }
export interface RoundScript { code: string; hash: string; address: string }
interface RoundOpen { investor: string; earned: string; paid: string }
/** One member per stage, so narrowing on `stage` reaches the funded fields. */
export type RoundState = { stage: "offered" } | { stage: "cancelled" } | ({ stage: "active" } & RoundOpen) | ({ stage: "closed" } & RoundOpen);
export const ROUND_MARKER = "526f756e64";
const blueprintPath = fileURLToPath(new URL("../../../contracts/cardano/plutus.json", import.meta.url));
const byte = (b: Uint8Array) => Buffer.from(b).toString("hex");
function credentialData(c: Address.Address["paymentCredential"]) { return Data.constr(c._tag === "KeyHash" ? 0n : 1n, [Data.bytearray(byte(c.hash))]); }
export function addressData(raw: string): Data.Data {
  const a = Address.fromBech32(raw);
  if (a.networkId !== 0) throw new Error("Funding rounds are preprod only");
  return Data.constr(0n, [credentialData(a.paymentCredential), a.stakingCredential ? Data.constr(0n, [Data.constr(0n, [credentialData(a.stakingCredential)])]) : Data.constr(1n, [])]);
}
function constr(d: Data.Data): Data.Constr { if (!Data.isConstr(d)) throw new Error("Invalid round datum"); return d; }
function credentialFrom(d: Data.Data) { const c = constr(d); if (!(c.fields[0] instanceof Uint8Array) || ![0n, 1n].includes(c.index)) throw new Error("Invalid address credential"); return c.index === 0n ? KeyHash.fromHex(byte(c.fields[0])) : ScriptHash.fromHex(byte(c.fields[0])); }
export function addressFromData(d: Data.Data): string {
  const a = constr(d), stake = constr(a.fields[1]!);
  return Address.toBech32(new Address.Address({ networkId: 0, paymentCredential: credentialFrom(a.fields[0]!), stakingCredential: stake.index === 1n ? undefined : credentialFrom(constr(stake.fields[0]!).fields[0]!) }));
}
export function stateData(s: RoundState): Data.Data {
  if (s.stage === "offered" || s.stage === "cancelled") return Data.constr(s.stage === "offered" ? 0n : 3n, []);
  return Data.constr(s.stage === "active" ? 1n : 2n, [addressData(s.investor), Data.int(BigInt(s.earned)), Data.int(BigInt(s.paid))]);
}
export function decodeRoundState(d: Data.Data): RoundState {
  const c = constr(d);
  if (c.index === 0n && !c.fields.length) return { stage: "offered" };
  if (c.index === 3n && !c.fields.length) return { stage: "cancelled" };
  if (![1n, 2n].includes(c.index) || c.fields.length !== 3 || typeof c.fields[1] !== "bigint" || typeof c.fields[2] !== "bigint") throw new Error("Invalid round state");
  const open: RoundOpen = { investor: addressFromData(c.fields[0]!), earned: String(c.fields[1]), paid: String(c.fields[2]) };
  return c.index === 1n ? { stage: "active", ...open } : { stage: "closed", ...open };
}
export function validateRoundTerms(t: RoundTerms) {
  const a = Address.fromBech32(t.operator);
  if (a.networkId !== 0 || a.paymentCredential._tag !== "KeyHash" || !/^[0-9a-f]{56}$/.test(t.policy) || !/^(?:[0-9a-f]{2}){0,32}$/.test(t.name)
    || !/^\d+$/.test(t.capital) || !/^\d+$/.test(t.cap) || BigInt(t.capital) <= 0n || BigInt(t.cap) <= 0n || !Number.isInteger(t.bps) || t.bps <= 0 || t.bps > 10000) throw new Error("Invalid preprod round terms");
}
export function buildRound(c: RoundConfig): RoundScript {
  validateRoundTerms(c.terms);
  if (!/^[0-9a-f]{64}$/.test(c.seed.txHash) || !Number.isSafeInteger(c.seed.index) || c.seed.index < 0) throw new Error("Invalid seed reference");
  const v = JSON.parse(readFileSync(blueprintPath, "utf8")).validators.find((v: { title: string }) => v.title === "funding_round.funding_round.spend");
  const t = c.terms;
  const code = unwrapCborBytes(UPLC.applyParamsToScript(v.compiledCode, [Data.constr(0n, [addressData(t.operator), Data.bytearray(t.policy), Data.bytearray(t.name), Data.int(BigInt(t.capital)), Data.int(BigInt(t.bps)), Data.int(BigInt(t.cap))]), Data.constr(0n, [Data.bytearray(c.seed.txHash), Data.int(BigInt(c.seed.index))])]));
  const hash = scriptHashOf(code);
  return { code, hash, address: Address.toBech32(new Address.Address({ networkId: 0, paymentCredential: ScriptHash.fromHex(hash) })) };
}
export interface RoundClient { getUtxos(a: Address.Address): Promise<UTxO.UTxO[]>; newTx(): any }
export async function readRound(client: RoundClient, config: RoundConfig) {
  const script = buildRound(config);
  const coins = await client.getUtxos(Address.fromBech32(script.address));
  const markers = coins.filter(u => Assets.getByUnit(u.assets, script.hash + ROUND_MARKER) === 1n);
  if (!markers.length) return { script, state: null, stateCoin: null, receipts: [] as UTxO.UTxO[] };
  if (markers.length !== 1 || markers[0]!.datumOption?._tag !== "InlineDatum") throw new Error("Round state cannot be authenticated");
  const stateCoin = markers[0]!;
  const state = decodeRoundState((stateCoin.datumOption as InlineDatum.InlineDatum).data);
  const receipts = coins.filter(u => Assets.getByUnit(u.assets, script.hash + ROUND_MARKER) === 0n && Assets.getByUnit(u.assets, config.terms.policy + config.terms.name) > 0n);
  return { script, state, stateCoin, receipts };
}
function asset(t: RoundTerms, n: bigint) { return Assets.addByHex(Assets.zero, t.policy, t.name, n); }
function attached(client: RoundClient, s: RoundScript) { return client.newTx().attachScript({ script: new PlutusV3.PlutusV3({ bytes: Buffer.from(s.code, "hex") }) }); }
function signer(tx: any, raw: string) { const a = Address.fromBech32(raw); if (a.networkId !== 0 || a.paymentCredential._tag !== "KeyHash") throw new Error("Preprod key wallet required"); return tx.addSigner({ keyHash: a.paymentCredential }); }
export async function prepareRoundOpen(client: RoundClient, config: RoundConfig) {
  const s = buildRound(config), t = config.terms;
  const coins = await client.getUtxos(Address.fromBech32(t.operator));
  const seed = coins.find(u => TransactionHash.toHex(u.transactionId) === config.seed.txHash && Number(u.index) === config.seed.index);
  if (!seed) throw new Error("Seed is spent or unavailable; inspect existing round before retrying");
  return signer(attached(client, s).collectFrom({ inputs: [seed] }).mintAssets({ assets: Assets.addByHex(Assets.zero, s.hash, ROUND_MARKER, 1n), redeemer: Data.constr(0n, []) })
    .payToAddress({ address: Address.fromBech32(s.address), assets: Assets.addByHex(Assets.fromLovelace(5_000_000n), s.hash, ROUND_MARKER, 1n), datum: new InlineDatum.InlineDatum({ data: stateData({ stage: "offered" }) }) }), t.operator).build({ autoMinUtxo: true });
}
export async function prepareRoundFund(client: RoundClient, config: RoundConfig, investor: string) {
  const { script, state, stateCoin } = await readRound(client, config);
  if (!stateCoin || state?.stage !== "offered") throw new Error("Round is not open for funding");
  if (investor === config.terms.operator) throw new Error("Investor and operator addresses must differ");
  return signer(attached(client, script).collectFrom({ inputs: [stateCoin], redeemer: Data.constr(0n, [addressData(investor)]) })
    .payToAddress({ address: Address.fromBech32(config.terms.operator), assets: asset(config.terms, BigInt(config.terms.capital)) })
    .payToAddress({ address: stateCoin.address, assets: stateCoin.assets, datum: new InlineDatum.InlineDatum({ data: stateData({ stage: "active", investor, earned: "0", paid: "0" }) }) }), investor).build({ autoMinUtxo: true });
}
export function nextPayout(state: RoundState, t: RoundTerms, revenue: bigint) {
  if (revenue <= 0n || state.stage === "offered") throw new Error("No funded revenue to distribute");
  if (state.stage === "cancelled") return { state, investor: 0n, operator: revenue };
  const earned = BigInt(state.earned) + revenue;
  const capped = earned * BigInt(t.bps) / 10000n;
  const paid = capped < BigInt(t.cap) ? capped : BigInt(t.cap);
  const investor = state.stage === "closed" ? 0n : paid - BigInt(state.paid);
  return { state: { ...state, stage: paid === BigInt(t.cap) ? "closed" : "active", earned: String(earned), paid: String(paid) } as RoundState, investor, operator: revenue - investor };
}
export async function prepareRoundDistribute(client: RoundClient, config: RoundConfig) {
  const { script, state, stateCoin, receipts } = await readRound(client, config);
  if (!state || !stateCoin || !receipts.length) throw new Error("No confirmed revenue waiting");
  const batch = receipts.slice(0, 4), t = config.terms;
  const plan = nextPayout(state, t, batch.reduce((n, u) => n + Assets.getByUnit(u.assets, t.policy + t.name), 0n));
  let tx = attached(client, script).collectFrom({ inputs: [stateCoin, ...batch], redeemer: Data.constr(1n, []) })
    .payToAddress({ address: stateCoin.address, assets: stateCoin.assets, datum: new InlineDatum.InlineDatum({ data: stateData(plan.state) }) });
  if (plan.investor > 0n && "investor" in state) tx = tx.payToAddress({ address: Address.fromBech32(state.investor), assets: asset(t, plan.investor) });
  if (plan.operator > 0n) tx = tx.payToAddress({ address: Address.fromBech32(t.operator), assets: asset(t, plan.operator) });
  return { built: await tx.build({ autoMinUtxo: true }), plan };
}
