export type DemoAction = "pay" | "tamper" | "distribute" | "rate";
export interface DemoOutcome {
  tone: "good" | "warn" | "bad";
  title: string;
  body: string;
}

/** Explain the recorded policy flags; a denial alone does not establish its cause. */
export function gateExplanation(lines: string[]): { verdict?: string; redirected: boolean; note: string } {
  const text = lines.join("\n");
  const verdict = text.match(/gate: (ALLOW|DENY|REVIEW)/)?.[1];
  const flags = text.match(/gate: (?:ALLOW|DENY|REVIEW) \(flags (\d+),/)?.[1];
  const redirected = flags !== undefined && (BigInt(flags) & 1n) !== 0n;
  return { verdict, redirected, note: verdict === "DENY" && redirected
    ? "Blocked: the recorded checks show a payment address outside the investor contract. Nothing was paid."
    : verdict === "DENY" ? "Blocked by the payment policy. Nothing was paid; the recorded result does not establish a redirect."
    : "Held for review: the checks were not all satisfied. Nothing was paid." };
}

/** A completed process is not proof that the action it promised succeeded. */
export function outcomeFor(action: DemoAction, lines: string[], ok: boolean | null): DemoOutcome {
  const text = lines.join("\n");
  if (ok === null) {
    return { tone: "warn", title: "The result could not be verified.", body: "The run may still be active or may have submitted a transaction. Check the server status and explorer links before trying again." };
  }
  if (ok === false) {
    return { tone: "bad", title: "This run did not complete successfully.", body: "Check the progress and transaction links below before trying again. A failed run may already have submitted a transaction." };
  }
  const { verdict, redirected } = gateExplanation(lines);
  if (action === "tamper" && verdict === "DENY" && redirected) {
    return { tone: "good", title: "Redirect test passed: payment blocked.", body: "Chainlink spotted that the money was being redirected away from the investor contract, so the buyer paid nothing." };
  }
  if (verdict === "DENY" || verdict === "REVIEW") {
    return { tone: "warn", title: "Chainlink did not approve this payment, so nothing was paid.", body: "The buyer keeps its money whenever a check does not pass." };
  }
  if (action === "tamper") {
    return { tone: "bad", title: "The tampered payment was not blocked.", body: "Check the payment gate's policy and the progress below." };
  }
  if (action === "distribute" && /nothing to distribute/.test(text)) {
    return { tone: "good", title: "Nothing waiting to split.", body: "No distribution transaction was needed." };
  }
  if (action === "rate" && /Rating unchanged/.test(text)) {
    return { tone: "good", title: "The rating is still current.", body: "Chainlink checked Atlas again. The stored rating is fresh and unchanged, so no new transaction was needed." };
  }
  const confirmed = action === "pay"
    ? verdict === "ALLOW" && /paid in [\d.]+ s:/.test(text) && /report verdict: (low|medium|high|unknown)/.test(text)
    : action === "distribute"
      ? /distributed \d+ coin/.test(text) && /tx [0-9a-f]{64}/.test(text)
      : /Rating \d+ written: 0x[0-9a-f]{64}/.test(text);
  if (!confirmed) {
    return { tone: "warn", title: "The result could not be confirmed.", body: "The process finished, but its output does not prove the requested action. Check the technical log and transaction links." };
  }
  return {
    tone: "good",
    title: action === "pay" ? "Payment submitted and report delivered." : action === "distribute" ? "Split submitted." : "Rating refreshed.",
    body: action === "pay"
      ? "Chainlink approved the purchase and the facilitator accepted the Cardano transaction. The explorer shows its confirmation status."
      : action === "distribute"
        ? "The keeper submitted the transaction paying the backer and Atlas. Open the explorer to check confirmation."
        : "Chainlink re-read Atlas's earnings, probed its service and recorded the score on Base Sepolia.",
  };
}
