import {
  ConsensusAggregationByFields,
  CronCapability,
  EVMClient,
  HTTPCapability,
  HTTPClient,
  LATEST_BLOCK_NUMBER,
  Runner,
  TxStatus,
  bytesToHex,
  encodeCallMsg,
  getNetwork,
  handler,
  identical,
  json,
  median,
  ok,
  prepareReportRequest,
  type NodeRuntime,
  type Runtime,
} from "@chainlink/cre-sdk";
import { RATING_KIND, challengeFor, scoreObservation, type Observation } from "./scoring";
import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  parseAbiParameters,
  sha256,
  stringToBytes,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

// Rates Atlas from what it actually earned on Cardano and whether its service answers,
// then records the score in AgentRatingRegistry on Base Sepolia.
export type Config = {
  schedule: string;
  authorizedKeys: { type: "KEY_TYPE_ECDSA_EVM"; publicKey: string }[];
  agentId: string;
  splitterAddress: string;
  usdmUnits: string[];
  atlasUrl: string;
  blockfrostBaseUrl: string;
  registryAddress: string;
  chainSelectorName: string;
  gasLimit: string;
};

type BlockfrostTotal = { address: string; received_sum: { unit: string; quantity: string }[]; tx_count: number };

const observe = (node: NodeRuntime<Config>, projectId: string, challenge: Hex): Observation => {
  const http = new HTTPClient();
  const cfg = node.config;

  const totals = http
    .sendRequest(node, {
      url: `${cfg.blockfrostBaseUrl}/addresses/${cfg.splitterAddress}/total`,
      method: "GET",
      headers: { project_id: projectId },
    })
    .result();
  let earnings = 0n;
  let txCount = 0n;
  // 404 means the splitter has never received anything yet.
  if (totals.statusCode !== 404) {
    if (!ok(totals)) throw new Error(`Blockfrost HTTP ${totals.statusCode}`);
    const body = json(totals) as BlockfrostTotal;
    if (body.address !== cfg.splitterAddress) throw new Error("Blockfrost answered for a different address");
    for (const a of body.received_sum) {
      if (cfg.usdmUnits.includes(a.unit)) earnings += BigInt(a.quantity);
    }
    txCount = BigInt(body.tx_count);
  }

  const started = node.now().getTime();
  const probe = http
    .sendRequest(node, { url: `${cfg.atlasUrl}/probe?challenge=${challenge.slice(2)}`, method: "GET" })
    .result();
  const latencyMs = BigInt(node.now().getTime() - started);
  let probeOk = false;
  if (ok(probe)) {
    const answer = (json(probe) as { answer?: string }).answer ?? "";
    probeOk = `0x${answer}` === sha256(challenge);
  }
  return { earnings, txCount, probeOk, latencyMs };
};

/** Rewrite an unchanged rating once it is this old, so the payment gate never sees it as stale. */
const MAX_RATING_AGE_SECONDS = 1800;

const registryAbi = parseAbi([
  "function getRating(bytes32 agentId) view returns ((uint16 score, uint256 earnings, uint32 paymentCount, bool probeOk, uint32 latencyMs, uint64 observedAt))",
]);

const rate = (runtime: Runtime<Config>, trigger: string): string => {
  const cfg = runtime.config;
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: cfg.chainSelectorName });
  if (!network) throw new Error(`Unknown chain selector name: ${cfg.chainSelectorName}`);
  const agentId = keccak256(stringToBytes(cfg.agentId));
  const now = runtime.now();

  const projectId = runtime.getSecret({ id: "BLOCKFROST_PROJECT_ID" }).result().value;
  const observation = runtime
    .runInNodeMode(
      observe,
      ConsensusAggregationByFields<Observation>({
        earnings: median,
        txCount: median,
        probeOk: identical,
        latencyMs: median,
      }),
    )(projectId, challengeFor(now))
    .result();
  const score = scoreObservation(observation);

  const evm = new EVMClient(network.chainSelector.selector);
  const stored = evm
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: cfg.registryAddress as Address,
        data: encodeFunctionData({ abi: registryAbi, functionName: "getRating", args: [agentId] }),
      }),
      // Latest, not finalized: Base Sepolia finality lags by many minutes, and this read only
      // decides whether to skip an unchanged write. The registry itself rejects stale reports.
      blockNumber: LATEST_BLOCK_NUMBER,
    })
    .result();
  const previous =
    stored.data.length === 0
      ? { score: 0, earnings: 0n, paymentCount: 0, probeOk: false, latencyMs: 0, observedAt: 0n }
      : decodeFunctionResult({ abi: registryAbi, functionName: "getRating", data: bytesToHex(stored.data) });

  const summary = {
    trigger,
    agentId,
    score: score.total.toString(),
    breakdown: {
      earnings: score.earningsPoints.toString(),
      activity: score.activityPoints.toString(),
      probe: score.probePoints.toString(),
      latency: score.latencyPoints.toString(),
    },
    earnings: observation.earnings.toString(),
    txCount: observation.txCount.toString(),
    probeOk: observation.probeOk,
    latencyMs: observation.latencyMs.toString(),
    previousScore: previous.score,
    change: Number(score.total) - previous.score,
  };

  runtime.log(`Agreed observation and score: ${JSON.stringify(summary)}`);

  // A rating is only useful while it is fresh: the payment gate rejects a stale one. So an
  // unchanged score still gets rewritten once it is older than MAX_RATING_AGE_SECONDS, which
  // keeps the timestamp moving without writing on every run.
  const ageSeconds = previous.observedAt === 0n ? Infinity : Math.floor(now.getTime() / 1000) - Number(previous.observedAt);
  const unchanged =
    previous.observedAt > 0n &&
    BigInt(previous.score) === score.total &&
    previous.earnings === observation.earnings &&
    BigInt(previous.paymentCount) === observation.txCount &&
    previous.probeOk === observation.probeOk;
  if (unchanged && ageSeconds < MAX_RATING_AGE_SECONDS) {
    runtime.log(`Rating unchanged at ${score.total}, written ${ageSeconds}s ago; skipping write`);
    return JSON.stringify({ ...summary, written: false });
  }

  const body = encodeAbiParameters(parseAbiParameters("bytes32, uint16, uint256, uint32, bool, uint32, uint64"), [
    agentId,
    Number(score.total),
    observation.earnings,
    Number(observation.txCount),
    observation.probeOk,
    Number(observation.latencyMs),
    BigInt(Math.floor(now.getTime() / 1000)),
  ]);
  const report = runtime
    .report(prepareReportRequest(encodeAbiParameters(parseAbiParameters("uint8, bytes"), [RATING_KIND, body])))
    .result();
  const write = evm
    .writeReport(runtime, { receiver: cfg.registryAddress, report, gasConfig: { gasLimit: cfg.gasLimit } })
    .result();
  if (write.txStatus !== TxStatus.SUCCESS) throw new Error(write.errorMessage ?? `writeReport status ${write.txStatus}`);
  if (!write.txHash) throw new Error("writeReport succeeded without a transaction hash");

  const txHash = bytesToHex(write.txHash);
  runtime.log(`Rating ${score.total} written: ${txHash}`);
  return JSON.stringify({ ...summary, written: true, txHash });
};

export const onSchedule = (runtime: Runtime<Config>): string => rate(runtime, "cron");
// Dashboard "Refresh rating": the body is not needed, the workflow re-reads everything itself.
export const onRefresh = (runtime: Runtime<Config>, _payload: { input: Uint8Array }): string => rate(runtime, "http");

export const initWorkflow = (config: Config) => [
  handler(new CronCapability().trigger({ schedule: config.schedule }), onSchedule),
  handler(new HTTPCapability().trigger({ authorizedKeys: config.authorizedKeys }), onRefresh),
];

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
