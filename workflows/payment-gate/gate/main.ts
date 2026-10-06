import {
  EVMClient,
  EVMRestrictor,
  HTTPCapability,
  HTTPClient,
  HTTPClientRestrictor,
  LATEST_BLOCK_NUMBER,
  Runner,
  TxStatus,
  bytesToHex,
  encodeCallMsg,
  getNetwork,
  handlerInTee,
  hexToBase64,
  type Runtime,
  type TeeRuntime,
} from "@chainlink/cre-sdk";
import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  parseAbiParameters,
  stringToBytes,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import {
  FLAG,
  VERDICT_CODE,
  auditorFlags,
  bindingFlags,
  decide,
  describeFlags,
  parseAuditorOutput,
  parseProposal,
  ratingFlags,
  type AuditorResult,
  type GatePolicy,
  type PaymentProposal,
  type StoredRating,
} from "./policy";
import { auditorRequest, auditorText, OFFER_AUDIT, REPORT_AUDIT, type AuditorConfig } from "./auditors";

// Approves or blocks a buyer agent's payment to Atlas before any money moves. Runs inside a TEE:
// LLM keys, the Blockfrost key, prompts and model answers stay in the enclave; only the verdict,
// flags and the rating used cross back to the DON for the Base Sepolia write.
export type Config = {
  authorizedKeys: { type: "KEY_TYPE_ECDSA_EVM"; publicKey: string }[];
  atlasUrl: string;
  blockfrostBaseUrl: string;
  registryAddress: string;
  chainSelectorName: string;
  gasLimit: string;
  blockfrostSecretId: string;
  auditors: AuditorConfig[];
  policy: GatePolicy;
};

const DECISION_KIND = 2;
const registryAbi = parseAbi([
  "function getRating(bytes32 agentId) view returns ((uint16 score, uint256 earnings, uint32 paymentCount, bool probeOk, uint32 latencyMs, uint64 observedAt))",
]);

const network = (cfg: Config) => {
  const n = getNetwork({ chainFamily: "evm", chainSelectorName: cfg.chainSelectorName });
  if (!n) throw new Error(`Unknown chain selector name: ${cfg.chainSelectorName}`);
  return n;
};

const readRating = (don: Runtime<Config>, agentId: Hex): StoredRating => {
  const evm = new EVMClient(network(don.config).chainSelector.selector);
  const reply = evm
    .callContract(don, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: don.config.registryAddress as Address,
        data: encodeFunctionData({ abi: registryAbi, functionName: "getRating", args: [agentId] }),
      }),
      blockNumber: LATEST_BLOCK_NUMBER,
    })
    .result();
  if (reply.data.length === 0) return { score: 0, observedAt: 0n };
  const r = decodeFunctionResult({ abi: registryAbi, functionName: "getRating", data: bytesToHex(reply.data) });
  return { score: r.score, observedAt: r.observedAt };
};

/** The slice of HTTPClient the gate uses; tests substitute a fake. */
export type Http = {
  sendRequest: (
    runtime: TeeRuntime<Config>,
    req: { url: string; method: string; headers?: Record<string, string>; body?: string },
  ) => { result: () => { statusCode: number; body: Uint8Array } };
};

const getText = (runtime: TeeRuntime<Config>, http: Http, url: string, headers: Record<string, string> = {}) => {
  const res = http.sendRequest(runtime, { url, method: "GET", headers }).result();
  return { status: res.statusCode, body: new TextDecoder().decode(res.body) };
};

const splitterIsLive = (runtime: TeeRuntime<Config>, http: Http, payTo: string): boolean => {
  const projectId = runtime.getSecret({ id: runtime.config.blockfrostSecretId }).result().value;
  const res = getText(runtime, http, `${runtime.config.blockfrostBaseUrl}/addresses/${payTo}`, { project_id: projectId });
  if (res.status !== 200) return false;
  const body = JSON.parse(res.body) as { address?: string; script?: boolean };
  return body.address === payTo && body.script === true;
};

const audit = (
  runtime: TeeRuntime<Config>,
  http: Http,
  auditor: AuditorConfig,
  prompt: string,
): AuditorResult => {
  const key = runtime.getSecret({ id: auditor.secretId }).result().value;
  const req = auditorRequest(auditor, key, prompt);
  const res = http
    .sendRequest(runtime, {
      url: auditor.url,
      method: "POST",
      headers: req.headers,
      body: hexToBase64(bytesToHex(new TextEncoder().encode(req.body))),
    })
    .result();
  if (res.statusCode >= 400) {
    return { auditor: auditor.name, verdict: "review", confidence: 0, reasons: [`auditor HTTP ${res.statusCode}`], malformed: true };
  }
  const text = auditorText(auditor.provider, new TextDecoder().decode(res.body));
  return text === null
    ? { auditor: auditor.name, verdict: "review", confidence: 0, reasons: ["auditor reply had no text"], malformed: true }
    : parseAuditorOutput(auditor.name, text);
};

export type GateOutcome = {
  requestId: Hex;
  agentId: Hex;
  verdict: "ALLOW" | "DENY" | "REVIEW";
  flags: number;
  reasons: string[];
  ratingUsed: number;
};

/** The decision itself. Separated from the trigger so tests can drive it with a fake runtime. */
export const evaluate = (
  runtime: TeeRuntime<Config>,
  proposal: PaymentProposal,
  http: Http = new HTTPClient() as unknown as Http,
  rate: (don: Runtime<Config>, agentId: Hex) => StoredRating = readRating,
): GateOutcome => {
  const cfg = runtime.config;
  const don = runtime.usingTheDons();
  const agentId = keccak256(stringToBytes(proposal.agentId));
  const nowSeconds = BigInt(Math.floor(runtime.now().getTime() / 1000));

  let flags = bindingFlags(proposal, cfg.policy);
  const rating = rate(don, agentId);
  flags |= ratingFlags(rating, cfg.policy, nowSeconds);

  // A wrong destination is denied outright; no need to spend calls on auditors.
  if (decide(flags) !== "DENY") {
    if (!splitterIsLive(runtime, http, proposal.payTo)) flags |= FLAG.splitterNotOnChain;

    const sample = getText(runtime, http, `${cfg.atlasUrl}/sample`);
    const sampleReport = sample.status === 200 ? sample.body : `unavailable (HTTP ${sample.status})`;
    const facts = { proposal: { ...proposal, scriptCode: `${proposal.scriptCode.length / 2} bytes` }, rating: { score: rating.score, observedAt: rating.observedAt.toString() } };
    const results = [
      audit(runtime, http, cfg.auditors[0]!, OFFER_AUDIT(facts, cfg.policy)),
      audit(runtime, http, cfg.auditors[cfg.auditors.length > 1 ? 1 : 0]!, REPORT_AUDIT(sampleReport)),
    ];
    flags |= auditorFlags(results, cfg.policy);
    // Model reasoning stays in the enclave; only the derived flags leave it.
    runtime.log(`auditors: ${results.map((r) => `${r.auditor}=${r.verdict}/${r.confidence}${r.malformed ? " (malformed)" : ""}`).join(", ")}`);
  }

  return {
    requestId: proposal.requestId,
    agentId,
    verdict: decide(flags),
    flags,
    reasons: describeFlags(flags),
    ratingUsed: rating.score,
  };
};

const record = (runtime: TeeRuntime<Config>, outcome: GateOutcome): string => {
  const don = runtime.usingTheDons();
  const body = encodeAbiParameters(parseAbiParameters("bytes32, bytes32, uint8, uint32, uint16, uint64"), [
    outcome.requestId,
    outcome.agentId,
    VERDICT_CODE[outcome.verdict],
    outcome.flags,
    outcome.ratingUsed,
    BigInt(Math.floor(runtime.now().getTime() / 1000)),
  ]);
  const report = don
    .report({
      encodedPayload: hexToBase64(encodeAbiParameters(parseAbiParameters("uint8, bytes"), [DECISION_KIND, body])),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();
  const write = new EVMClient(network(runtime.config).chainSelector.selector)
    .writeReport(don, { receiver: runtime.config.registryAddress, report, gasConfig: { gasLimit: runtime.config.gasLimit } })
    .result();
  if (write.txStatus !== TxStatus.SUCCESS) throw new Error(write.errorMessage ?? `writeReport status ${write.txStatus}`);
  if (!write.txHash) throw new Error("writeReport succeeded without a transaction hash");
  return bytesToHex(write.txHash);
};

export const onProposal = (runtime: TeeRuntime<Config>, payload: { input: Uint8Array }): string => {
  const proposal = parseProposal(new TextDecoder().decode(payload.input));
  const outcome = evaluate(runtime, proposal);
  const txHash = record(runtime, outcome);
  runtime.log(`decision ${outcome.verdict} for ${outcome.requestId}: ${outcome.reasons.join(", ") || "all checks passed"} tx=${txHash}`);
  return JSON.stringify({ ...outcome, txHash });
};

const CONSENSUS_CAPABILITY_ID = "consensus@1.0.0-alpha";

/** Closed capability list: exactly what one decision needs, and only our named secrets. */
export const buildRestrictions = (config: Config) => {
  const selector = BigInt(network(config).chainSelector.selector);
  const evm = new EVMRestrictor(selector);
  return {
    capabilities: {
      type: "CAPABILITY_RESTRICTION_TYPE_CLOSED" as const,
      maxTotalCalls: 7,
      restrictions: [
        new HTTPClientRestrictor().limitSendRequest(4),
        evm.limitCallContract(1),
        evm.limitWriteReport(1),
        { method: { id: CONSENSUS_CAPABILITY_ID, method: "Report", maxCalls: 1 } },
      ],
    },
    secrets: {
      maxSecrets: 3,
      restrictions: [config.blockfrostSecretId, ...config.auditors.map((a) => a.secretId)]
        .filter((id, i, all) => all.indexOf(id) === i)
        .map((id) => ({ exactSecret: { id, namespace: "main" } })),
    },
  };
};

export const initWorkflow = (config: Config) => {
  if (config.auditors.length === 0) throw new Error("config.auditors needs at least one auditor");
  return [
    handlerInTee(new HTTPCapability().trigger({ authorizedKeys: config.authorizedKeys }), onProposal, {}, {
      preHook: (cfg: Config) => buildRestrictions(cfg),
    }),
  ];
};

/**
 * The restriction pre-hook can run before the target config is supplied, as in Chainlink's
 * ai-audit-firewall template. These defaults only feed buildRestrictions; every decision
 * runs with the real target config.
 */
const PREHOOK_CONFIG: Config = {
  authorizedKeys: [],
  atlasUrl: "prehook-default",
  blockfrostBaseUrl: "prehook-default",
  registryAddress: zeroAddress,
  chainSelectorName: "ethereum-testnet-sepolia-base-1",
  gasLimit: "500000",
  blockfrostSecretId: "blockfrost_project_id",
  auditors: [
    { name: "offer-integrity", provider: "openai", url: "prehook-default", model: "prehook-default", secretId: "auditor_a_key" },
    { name: "report-quality", provider: "openai", url: "prehook-default", model: "prehook-default", secretId: "auditor_b_key" },
  ],
  policy: {
    splitterAddress: "prehook-default",
    splitterCodeHash: zeroAddress,
    allowedAssets: [],
    maxAmount: "0",
    minScore: 1000,
    maxRatingAgeSeconds: 0,
    minAuditorConfidence: 100,
  },
};

export async function main() {
  const runner = await Runner.newRunner<Config>({
    configParser: (raw: Uint8Array) => {
      const text = new TextDecoder().decode(raw);
      return text.trim() === "" ? PREHOOK_CONFIG : (JSON.parse(text) as Config);
    },
  });
  await runner.run(initWorkflow);
}
