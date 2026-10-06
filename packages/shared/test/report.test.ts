import { describe, expect, it } from "vitest";
import {
  ChainClient,
  InvalidInputError,
  TUSDM_X402_UNIT,
  buildReport,
  classify,
  extractCandidate,
  renderInputHelpMarkdown,
  renderReportMarkdown,
  scoreFacts,
  type Facts,
} from "../src/index.js";

const ADDR = "addr_test1qpqw23utxnpaslm43vwt6cu8w7zvk85hyr095tww4n24nngjkny4xtt6hpfvcrsaknujy3rzrzqp5gxv8zzvfg7r3x0sx779zx";
const STAKE = "stake_test1uqftfj2n94ats5kvpcwmf7fzg33p3qq6yrxr3pxy50pcn8cdm6923";
const OTHER = "addr_test1qrseuc9dfg2qdn7vkg35lxnpzjk4y67nemcmmkc2k5t2yk6ddv3uplh7wk4p468pte5fpxgckpmuu2jcuk5vr2qpgz2q7gyegt";
const NOW = 1_791_255_927;
const DAY = 86_400;

const base: Facts = {
  found: true,
  isScript: false,
  hasStakeKey: true,
  balanceLovelace: 5_000_000n,
  tokenKinds: 1,
  txCount: 120,
  firstSeen: NOW - 400 * DAY,
  lastSeen: NOW - 2 * DAY,
  txsLast24h: 0,
  txsLast30d: 4,
  delegatedPool: "pool1abc",
  crossCheckMatches: true,
  isRegisteredAgent: false,
  thinCounterparties: 0,
};

describe("input parsing", () => {
  it("classifies preprod addresses, stake addresses and handles", () => {
    expect(classify(ADDR).kind).toBe("payment-address");
    expect(classify(STAKE).kind).toBe("stake-address");
    expect(classify("$Atlas").value).toBe("$atlas");
  });

  it("rejects mainnet and junk with a hint", () => {
    expect(() => classify("addr1qx2kd28nq8ac5prwg32hhvudlwggpgfp8utlyqxu6wqgz62f79qsdmm5dsknt9ecr5w468r9ey0fxwkdrwh08ly3tu9sy0f4qd")).toThrow(InvalidInputError);
    expect(() => classify("hello")).toThrow(/could not read/);
  });

  it("finds an address inside free text", () => {
    expect(extractCandidate(`Please check ${ADDR} before we pay`)).toBe(ADDR);
    expect(extractCandidate("no address here")).toBeNull();
  });
});

describe("scoring", () => {
  it("rates an established, active wallet as low risk", () => {
    const s = scoreFacts(base, NOW);
    expect(s.verdict).toBe("low");
    expect(s.risk).toBe(0);
    expect(s.goodSigns.length).toBeGreaterThan(2);
  });

  it("rates a brand-new wallet with little history as high risk", () => {
    const s = scoreFacts({ ...base, txCount: 1, firstSeen: NOW - 3600, lastSeen: NOW - 3600, txsLast30d: 1 }, NOW);
    expect(s.verdict).toBe("high");
    expect(s.redFlags.map((f) => f.code)).toEqual(["brand_new", "little_history"]);
    expect(s.risk).toBe(50);
  });

  it("treats an unused address as unknown", () => {
    const s = scoreFacts({ ...base, found: false }, NOW);
    expect(s.verdict).toBe("unknown");
    expect(s.risk).toBe(60);
  });

  it("treats a registered AI agent as an identity, not an unknown contract", () => {
    const s = scoreFacts({ ...base, isScript: true, isRegisteredAgent: true }, NOW);
    expect(s.redFlags.map((f) => f.code)).not.toContain("smart_contract");
    expect(s.goodSigns.join(" ")).toMatch(/registered as an ai agent/i);
  });

  it("flags a wallet surrounded by brand-new counterparties", () => {
    const s = scoreFacts({ ...base, thinCounterparties: 2 }, NOW);
    expect(s.redFlags.map((f) => f.code)).toContain("thin_counterparties");
  });

  it("flags disagreeing sources and smart contracts", () => {
    const s = scoreFacts({ ...base, isScript: true, crossCheckMatches: false }, NOW);
    expect(s.redFlags.map((f) => f.code)).toEqual(["smart_contract", "sources_disagree"]);
    expect(s.verdict).toBe("medium");
  });

  it("caps risk at 100", () => {
    const s = scoreFacts(
      { ...base, txCount: 0, firstSeen: NOW, lastSeen: NOW, txsLast24h: 20, isScript: true, balanceLovelace: 0n, crossCheckMatches: false },
      NOW,
    );
    expect(s.risk).toBeLessThanOrEqual(100);
  });
});

function mockChain(routes: Record<string, unknown>): ChainClient {
  const fetch = async (url: string) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200 });
  };
  return new ChainClient({ blockfrostProjectId: "test", fetch });
}

describe("buildReport", () => {
  const tx1 = "a".repeat(64);
  const tx2 = "b".repeat(64);
  const routes = {
    [`/addresses/${ADDR}/total`]: { tx_count: 7 },
    [`/addresses/${ADDR}/transactions?order=asc`]: [{ tx_hash: tx2, block_time: NOW - 40 * DAY }],
    [`/addresses/${ADDR}/transactions?order=desc`]: [
      { tx_hash: tx1, block_time: NOW - 3600 },
      { tx_hash: tx2, block_time: NOW - 40 * DAY },
    ],
    [`/addresses/${ADDR}`]: {
      address: ADDR,
      stake_address: STAKE,
      script: false,
      amount: [
        { unit: "lovelace", quantity: "9996321804" },
        { unit: TUSDM_X402_UNIT, quantity: "1000000000" },
      ],
    },
    [`/accounts/${STAKE}`]: { active: false, pool_id: null },
    [`/txs/${tx1}/utxos`]: { inputs: [{ address: ADDR }], outputs: [{ address: OTHER }, { address: ADDR }] },
    [`/txs/${tx2}/utxos`]: { inputs: [{ address: OTHER }], outputs: [{ address: ADDR }] },
    "/address_info": [{ balance: "9996321804" }],
  };

  it("assembles facts, cross-check, method and sources", async () => {
    const report = await buildReport(ADDR, { chain: mockChain(routes), now: NOW });
    expect(report.facts.txCount).toBe(7);
    expect(report.facts.balanceAda).toBe("9996.321804");
    expect(report.facts.tusdmBalance).toBe("1000");
    expect(report.facts.ageDays).toBe(40);
    expect(report.facts.topCounterparties).toEqual([{ address: OTHER, transactions: 2 }]);
    expect(report.crossCheck.matches).toBe(true);
    expect(report.score.verdict).toBe("low");
    expect(report.sources.some((s) => s.provider === "koios")).toBe(true);
    expect(report.sources.flatMap((s) => s.txHashes ?? [])).toEqual([tx1, tx2]);
    expect(report.method.length).toBe(6);
    expect(report.scoringRules.length).toBeGreaterThan(5);
  });

  it("renders readable markdown with a verdict first and explorer links", async () => {
    const report = await buildReport(ADDR, { chain: mockChain(routes), now: NOW });
    const md = renderReportMarkdown(report);
    expect(md.split("\n")[0]).toMatch(/^\*\*Low risk \(\d+\/100\)\*\*/);
    expect(md).toContain("### Red flags");
    expect(md).toContain("### How this was checked");
    expect(md).toContain(`https://preprod.cardanoscan.io/transaction/${tx1}`);
    expect(md).not.toContain("{");
  });

  it("reports an address that was never used as unknown", async () => {
    const report = await buildReport(ADDR, { chain: mockChain({ "/address_info": [] }), now: NOW });
    expect(report.facts.found).toBe(false);
    expect(report.score.verdict).toBe("unknown");
  });

  it("explains bad input in plain words", () => {
    try {
      classify("not-an-address");
    } catch (err) {
      expect(renderInputHelpMarkdown(err as InvalidInputError)).toContain("addr_test1");
    }
  });
});
