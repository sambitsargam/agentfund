import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicClient, http, parseAbi, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import type { PaymentProposal } from "./offer.js";

export type GateVerdict = "ALLOW" | "DENY" | "REVIEW";

export interface GateDecision {
  verdict: GateVerdict;
  riskFlags: number;
  ratingUsed: number;
  decidedAt: bigint;
  /** Base Sepolia transaction that recorded the decision, when known. */
  txHash?: Hex;
}

const VERDICTS: Record<number, GateVerdict> = { 1: "ALLOW", 2: "DENY", 3: "REVIEW" };

const registryAbi = parseAbi([
  "function getDecision(bytes32 requestId) view returns ((bytes32 agentId, uint8 verdict, uint32 riskFlags, uint16 ratingUsed, uint64 decidedAt))",
]);

export interface GateOptions {
  registryAddress: Hex;
  rpcUrl: string;
  /** Directory holding the payment-gate CRE project (project.yaml). */
  workflowProject: string;
  creBin: string;
  pollMs?: number;
  timeoutMs?: number;
}

/**
 * Submits a proposal to the CRE payment gate and waits for its decision on Base Sepolia.
 * Until the workflow is deployed to a DON, submission runs it with `cre workflow simulate --broadcast`,
 * which executes the same handler and writes a real transaction through the simulation forwarder.
 */
export class PaymentGate {
  private readonly client;

  constructor(private readonly opts: GateOptions) {
    this.client = createPublicClient({ chain: baseSepolia, transport: http(opts.rpcUrl) });
  }

  async read(requestId: Hex): Promise<GateDecision | null> {
    const d = await this.client.readContract({
      address: this.opts.registryAddress,
      abi: registryAbi,
      functionName: "getDecision",
      args: [requestId],
    });
    const verdict = VERDICTS[d.verdict];
    return verdict ? { verdict, riskFlags: d.riskFlags, ratingUsed: d.ratingUsed, decidedAt: d.decidedAt } : null;
  }

  async submit(proposal: PaymentProposal): Promise<{ txHash?: Hex; log: string }> {
    const dir = mkdtempSync(join(tmpdir(), "agentfund-proposal-"));
    const file = join(dir, "proposal.json");
    writeFileSync(file, JSON.stringify(proposal));
    const args = [
      "workflow", "simulate", "gate",
      "--target", "staging-settings",
      "--non-interactive", "--trigger-index", "0",
      "--http-payload", file,
      "--broadcast",
    ];
    const log = await new Promise<string>((resolve, reject) => {
      const child = spawn(this.opts.creBin, args, { cwd: this.opts.workflowProject });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`gate run failed (${code}): ${out.slice(-600)}`))));
    });
    const txHash = log.match(/tx=(0x[0-9a-f]{64})/)?.[1] as Hex | undefined;
    return { txHash, log };
  }

  /** Polls the registry until the decision for this request appears. */
  async waitForDecision(requestId: Hex): Promise<GateDecision> {
    const deadline = Date.now() + (this.opts.timeoutMs ?? 120_000);
    while (Date.now() < deadline) {
      const d = await this.read(requestId);
      if (d) return d;
      await new Promise((r) => setTimeout(r, this.opts.pollMs ?? 2_000));
    }
    throw new Error(`no gate decision for ${requestId} within the timeout`);
  }
}
