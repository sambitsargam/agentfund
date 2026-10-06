import { describe, expect, it } from "vitest";
import { outcomeFor, gateExplanation } from "../lib/demo-outcome";

describe("demo outcomes", () => {
  it("never reports success when a payment fails after approval", () => {
    expect(outcomeFor("pay", ["gate: ALLOW", "payment failed: HTTP 402"], false).tone).toBe("bad");
  });
  it("requires payment and delivery evidence even after a successful process exit", () => {
    expect(outcomeFor("pay", ["gate: ALLOW"], true).tone).toBe("warn");
    expect(outcomeFor("pay", ["gate: ALLOW"], null).tone).toBe("warn");
    expect(outcomeFor("pay", ["gate: ALLOW", "paid in 20.0 s:", "report verdict: low (15/100)"], true).tone).toBe("good");
  });
  it("distinguishes a deterministic tamper denial from a review", () => {
    expect(outcomeFor("tamper", ["gate: DENY (flags 1, rating 710)", "not paying."], true).title).toMatch(/Redirect test passed/);
    expect(outcomeFor("tamper", ["gate: REVIEW", "not paying."], true).tone).toBe("warn");
  });
  it("does not invent a redirect reason for unrelated or missing policy flags", () => {
    expect(gateExplanation(["gate: DENY (flags 8, rating 710)"]).redirected).toBe(false);
    expect(gateExplanation(["gate: DENY"]).note).not.toMatch(/show a payment address/);
    expect(outcomeFor("tamper", ["gate: DENY (flags 8, rating 710)"], true).tone).toBe("warn");
    expect(outcomeFor("pay", ["gate: DENY (flags 1, rating 710)"], true).title).not.toMatch(/test passed/);
  });
  it("does not claim that an empty distribution paid the investor", () => {
    expect(outcomeFor("distribute", ["nothing to distribute"], true).title).toBe("Nothing waiting to split.");
  });
  it("does not claim a new rating transaction when an unchanged rating is skipped", () => {
    expect(outcomeFor("rate", ["Rating unchanged at 505, written 100s ago; skipping write"], true).body).toMatch(/no new transaction/);
  });
  it("does not call a failed tamper process a successful block", () => {
    expect(outcomeFor("tamper", ["gate: DENY"], false).tone).toBe("bad");
  });
});
