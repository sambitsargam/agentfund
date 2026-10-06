# Architecture

## The one-sentence version

Atlas earns money two ways; both land in a Cardano contract that pays its investor before it pays Atlas; Chainlink decides whether each agent payment is safe before it happens.

## Components

| Component | Language / stack | Responsibility |
| --- | --- | --- |
| `contracts/cardano` | Aiken, Plutus V3 | The splitter. The only thing that can release locked funds, and only by paying investors their share |
| `contracts/evm` | Solidity, Foundry | `AgentRatingRegistry` on Base Sepolia: the public record of ratings and payment decisions |
| `workflows/rating` | TypeScript, CRE SDK 1.23.0 | Rates Atlas from its real earnings and a live probe; writes when something changed |
| `workflows/payment-gate` | TypeScript, CRE SDK 1.18.0, TEE | Approves or blocks an agent payment before it happens |
| `packages/shared` | TypeScript | The report engine, asset constants, deal terms, explorer links. Shared by the x402 route and the Sokosumi worker so there is one implementation |
| `packages/cardano-tx` | TypeScript, Evolution SDK | Derives the splitter address from the deal; builds distribution transactions |
| `services/atlas` | Express, `@x402/*` 2.26.0 | The paid `/report` route, the free `/probe` and `/sample`, and the x402 manifest |
| `services/coworker` | TypeScript | Polls Sokosumi for Tasks; runs the Masumi paid flow |
| `services/buyer-agent` | TypeScript | An autonomous buyer with a budget, gated by CRE |
| `services/keeper` | TypeScript | Batches locked payments and distributes them |
| `apps/web` | Next.js 15 | The dashboard, read entirely from the chains |

## The two flows

### An agent buys a report

```
buyer                atlas            CRE gate           registry        splitter
  │   GET /report      │                 │                  │               │
  │ ─────────────────► │                 │                  │               │
  │ ◄───── 402 + offer │                 │                  │               │
  │        (payTo = splitter, script, receipt datum)        │               │
  │                                      │                  │               │
  │   proposal ───────────────────────►  │                  │               │
  │                                 reads rating ─────────► │               │
  │                                 checks payTo + script ──────────────►   │
  │                                 two LLM auditors (in the enclave)       │
  │                                 writes verdict ───────► │               │
  │ ◄──── Allow / Deny / Review          │                  │               │
  │                                                                         │
  │   on Allow only: x402 payment, script method ─────────────────────────► │
  │ ◄──── 200 + report                                                      │
```

The buyer re-checks the 402 against the approved offer before paying, so a changed offer is refused rather than paid.

### A team hires Atlas on Sokosumi

```
Task READY → worker starts it → signed seller terms from MPS
  → masumiPayment event to Core → escrow funded on-chain
  → Atlas writes the report → result hash submitted to MPS
  → Task COMPLETED with the report → dispute window
  → collection → splitter → split to investor and Atlas
```

Every step is written to the worker's task file before the call that performs it, so a restart resumes rather than repeating a payment write. A step that was interrupted mid-write is marked for inspection instead of retried.

## Key design decisions

**The deal lives in the script hash.** Investors, shares and governed assets are script parameters, so the address *is* the deal. Money already locked cannot be re-split under new terms. The cost is that adding an investor creates a new address.

**The datum is ignored.** x402's `script` method attaches a receipt datum, plain payments attach none, and escrow collections attach their own. A validator that required a datum shape would reject two of its three income sources.

**One script run per transaction, not per input.** The ledger runs the validator once per locked input. Only the first one performs the whole-transaction check; the rest return immediately. This took a 10-input batch from 129% of the memory limit to 82% in tests, and the real on-chain cost of the full check is 1.7%.

**Settlement at zero confirmations.** The hosted facilitator's gateway times out around 60 seconds while waiting for a block, which caused a buyer to pay and receive nothing. `confirmationPolicy: { l1Confirmations: 0 }` returns on submission instead.

**Earnings are read from the splitter, not Atlas's wallet.** A wallet's own change counts as "received" in Blockfrost's totals, which would inflate earnings. The splitter has no change outputs, so what it received is what customers actually paid.

**The gate's deterministic checks run before the auditors.** A wrong destination is a Deny without spending a single LLM call, so the expensive, fallible part only runs on payments that already look sound.

**The dashboard reads chains, not our services.** Ratings and decisions come from registry events, payments and splits from splitter transactions, joined by the request id in the receipt datum. Only the Sokosumi task feed comes from our worker, and the page degrades gracefully when it is unreachable.

## Versions, pinned

`@x402/*` 2.26.0 (the Cardano track's content freeze) · `@evolution-sdk/evolution` 0.5.16 · Aiken v1.1.24 with stdlib v3.1.0 and fuzz v2.2.0 · `@chainlink/cre-sdk` 1.23.0 for the rating workflow and 1.18.0 for the gate, which is what its template pins · viem 2.57.3 · Next.js 15.5.27 · OpenZeppelin 5.6.1.
