#!/usr/bin/env bash
# A single take for the Chainlink CRE evidence recording.
#
# Runs the two decisions that matter, in order, with the CLI's banner noise stripped so the
# terminal shows the workflow's own reasoning:
#   1. a genuine agent payment  -> gate ALLOW -> the buyer pays on Cardano
#   2. the same payment, redirected -> gate DENY -> the buyer pays nothing
#
# Both write their verdict to Base Sepolia. Every run spends real preprod funds.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
SUBJECT="${DEMO_SUBJECT:-addr_test1wzs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgn37w4g}"

# Same filter the dashboard uses, so the recording matches what judges see there.
quiet() {
  grep -vE '^\s*at |node:internal|npm (warn|notice)|^>|[│╭╰─┃┌└├]|Update available|cre update|releases to upgrade|Initializing\.\.\.|Loading settings|Checking RPC|Compiling workflow|Simulation limits|Binary hash|Config hash|SIMULATION\]' \
    | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[^ ]+ +\[USER LOG\] *//'
}

banner() {
  printf '\n\033[1;33m%s\033[0m\n' "$1"
  printf '\033[2m%s\033[0m\n\n' "$2"
}

banner "1 / 3  Chainlink rates the agent" \
  "A cron workflow reads Atlas's real earnings on Cardano, probes its live service, the DON agrees on the numbers, and the signed rating is written to Base Sepolia."
( cd workflows/rating && cre workflow simulate rate-atlas --target staging-settings --non-interactive --trigger-index 0 --broadcast 2>&1 ) | quiet

banner "2 / 3  A genuine agent payment" \
  "The buyer agent asks the gate before paying. The gate checks the destination, the script hash, the asset and amount, the rating's freshness, then two AI auditors inside a TEE. On ALLOW the buyer pays on Cardano, and the payment carries the gate's request id in its datum."
npm run -s buy -w @agentfund/buyer-agent -- "$SUBJECT" 2>&1 | quiet

banner "3 / 3  The same payment, redirected" \
  "Identical offer, with the destination swapped away from the investor contract. The gate should refuse before any money moves. A DENY here is the demo working."
npm run -s buy -w @agentfund/buyer-agent -- "$SUBJECT" --tamper 2>&1 | quiet

banner "Done" \
  "Both verdicts are on Base Sepolia; the allowed payment is on Cardano preprod. Full evidence: docs/CHAINLINK_EVIDENCE.md"
