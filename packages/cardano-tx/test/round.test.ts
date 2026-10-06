import { describe, expect, it } from "vitest";
import { nextPayout, type RoundState, type RoundTerms } from "../src/round.js";

/** Mirrors ATLAS_ROUND_TERMS: 0.20 tUSDM capital, half the revenue, repaid up to 0.30 tUSDM. */
const terms: RoundTerms = {
  operator:
    "addr_test1qrseuc9dfg2qdn7vkg35lxnpzjk4y67nemcmmkc2k5t2yk6ddv3uplh7wk4p468pte5fpxgckpmuu2jcuk5vr2qpgz2q7gyegt",
  policy: "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9",
  name: "0014df10745553444d",
  capital: "200000",
  bps: 5000,
  cap: "300000",
};
const investor =
  "addr_test1qqwdk97gwef6ypkjcd9hhgpls8ela9fdvee2wvaxnkmjqdtj5pvye96gvjtm2jv70mtyqsczypsl8f2d3dgtlcmktk0sv74rjj";
const active = (earned: string, paid: string): RoundState => ({
  stage: "active",
  investor,
  earned,
  paid,
});

describe("nextPayout", () => {
  it("pays the share of the first revenue and keeps the round active", () => {
    const r = nextPayout(active("0", "0"), terms, 500_000n);
    expect(r.investor).toBe(250_000n);
    expect(r.operator).toBe(250_000n);
    expect(r.state).toEqual(active("500000", "250000"));
  });

  it("caps the final payout and closes the round", () => {
    const r = nextPayout(active("500000", "250000"), terms, 500_000n);
    // Half of 1.00 tUSDM is 0.50, but only 0.30 is owed in total, so 0.05 remains.
    expect(r.investor).toBe(50_000n);
    expect(r.operator).toBe(450_000n);
    expect(r.state).toEqual({
      stage: "closed",
      investor,
      earned: "1000000",
      paid: "300000",
    });
  });

  it("never exceeds the cap even when one payment would cross it alone", () => {
    const r = nextPayout(active("0", "0"), terms, 5_000_000n);
    expect(r.investor).toBe(300_000n);
    expect(r.state.stage).toBe("closed");
  });

  it("pays the investor nothing once closed, and all revenue to the operator", () => {
    const r = nextPayout(
      { stage: "closed", investor, earned: "1000000", paid: "300000" },
      terms,
      400_000n,
    );
    expect(r.investor).toBe(0n);
    expect(r.operator).toBe(400_000n);
    expect(r.state).toEqual({
      stage: "closed",
      investor,
      earned: "1400000",
      paid: "300000",
    });
  });

  it("rounds the share down, so dust stays with the operator", () => {
    // 3 units at 50% is 1.5; the validator floors it and the operator keeps the remainder.
    const r = nextPayout(active("0", "0"), terms, 3n);
    expect(r.investor).toBe(1n);
    expect(r.operator).toBe(2n);
  });

  it("keeps the investor's total at the floor of the cumulative share, not the sum of floors", () => {
    const first = nextPayout(active("0", "0"), terms, 3n);
    const second = nextPayout(first.state, terms, 3n);
    // Two 1.5-unit shares would floor to 1 + 1; cumulative flooring pays 1 then 2.
    expect(first.investor + second.investor).toBe(3n);
  });

  it("sends all revenue to the operator after a cancelled round", () => {
    const r = nextPayout({ stage: "cancelled" }, terms, 500_000n);
    expect(r.investor).toBe(0n);
    expect(r.operator).toBe(500_000n);
  });

  it("refuses a distribution with no revenue, and one before funding", () => {
    expect(() => nextPayout(active("0", "0"), terms, 0n)).toThrow(
      /no funded revenue/i,
    );
    expect(() => nextPayout({ stage: "offered" }, terms, 500_000n)).toThrow(
      /no funded revenue/i,
    );
  });
});
