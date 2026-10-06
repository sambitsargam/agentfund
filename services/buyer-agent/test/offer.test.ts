import { describe, expect, it } from "vitest";
import { Budget, offerFrom, sameOffer, tampered } from "../src/offer.js";

const req = { payTo: "addr_test1wzyuk", asset: "e675.0014", amount: "500000", extra: { script: { code: "ABCD" } } };

describe("offer", () => {
  it("reads the script offer and normalises the code", () => {
    expect(offerFrom(req)).toEqual({ payTo: "addr_test1wzyuk", asset: "e675.0014", amount: "500000", scriptCode: "abcd" });
  });

  it("rejects offers that do not lock into a script", () => {
    expect(() => offerFrom({ ...req, extra: {} })).toThrow(/script/);
  });

  it("treats any change in destination, amount or script as a different offer", () => {
    const a = offerFrom(req);
    expect(sameOffer(a, offerFrom(req))).toBe(true);
    expect(sameOffer(a, { ...a, payTo: "addr_test1other" })).toBe(false);
    expect(sameOffer(a, { ...a, amount: "500001" })).toBe(false);
    expect(sameOffer(a, { ...a, scriptCode: "abce" })).toBe(false);
  });

  it("tampering only changes the destination", () => {
    const p = { requestId: "0x01" as const, agentId: "atlas", resource: "r", ...offerFrom(req) };
    expect(tampered(p, "addr_test1evil")).toEqual({ ...p, payTo: "addr_test1evil" });
  });
});

describe("budget", () => {
  it("refuses spending past the limit and can release a reservation", () => {
    const b = new Budget(1_000_000n);
    b.reserve(600_000n);
    expect(() => b.reserve(500_000n)).toThrow(/budget exceeded/);
    b.release(600_000n);
    expect(b.remaining).toBe(1_000_000n);
  });
});
