import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scoreFacts, type Facts } from "../src/score.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/quality-cases.json", import.meta.url), "utf8"));

describe("report quality acceptance cases", () => {
  for (const c of fixture.cases) {
    it(`${c.id}: ${c.reason}`, () => {
      const facts: Facts = { ...c.facts, balanceLovelace: BigInt(c.facts.balanceLovelace) };
      const score = scoreFacts(facts, fixture.now);
      expect(score.verdict).toBe(c.expected.verdict);
      expect(score.risk).toBe(c.expected.risk);
      expect(score.redFlags.map(f => f.code)).toEqual(c.expected.flags);
      expect(score.headline).not.toBe("Low risk: an established address with normal activity.");
    });
  }
});
