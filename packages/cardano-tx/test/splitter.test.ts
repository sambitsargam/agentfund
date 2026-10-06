import { describe, expect, it } from "vitest";
import { UPLC } from "@evolution-sdk/evolution";
import { ATLAS_DEAL } from "@agentfund/shared";
import { buildSplitter, scriptHashOf, unwrapCborBytes, validateDeal } from "../src/index.js";

describe("splitter script", () => {
  it("derives the deployed preprod address from the Atlas deal", () => {
    const s = buildSplitter(ATLAS_DEAL);
    expect(s.hash).toBe("89cb6162847a8b6cc542cf4685495f0ba52ac72ab40bfad2bfdd111e");
    expect(s.address).toBe("addr_test1wzyukctzs3agkmx9gt85dp2ftu9622k8926qh7kjhlw3z8s7w0h96");
  });

  it("hashes the same way the x402 facilitator does for a pre-applied script", () => {
    const s = buildSplitter(ATLAS_DEAL);
    expect(scriptHashOf(unwrapCborBytes(UPLC.applyParamsToScript(s.code, [])))).toBe(s.hash);
  });

  it("changes address when the deal changes", () => {
    const other = buildSplitter({ ...ATLAS_DEAL, investors: [{ ...ATLAS_DEAL.investors[0]!, bps: 2000 }] });
    expect(other.address).not.toBe(buildSplitter(ATLAS_DEAL).address);
  });

  it("refuses shares that would lock funds forever", () => {
    expect(() => validateDeal({ ...ATLAS_DEAL, investors: [{ ...ATLAS_DEAL.investors[0]!, bps: 10_001 }] })).toThrow(/over 10000/);
    expect(() => validateDeal({ ...ATLAS_DEAL, investors: [{ ...ATLAS_DEAL.investors[0]!, bps: 0 }] })).toThrow(/positive/);
  });
});
