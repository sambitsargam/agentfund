# AgentFund

Investors fund an AI agent in exchange for a share of its future earnings. Cardano enforces the repayment at the payment itself, and Chainlink decides whether a payment is safe to make.

Atlas, the first funded agent, is a Cardano counterparty due-diligence Coworker. People hire it on the Sokosumi marketplace through Masumi escrow, and other agents pay it per report over x402. Every payment lands in an Aiken splitter contract that pays investors their share before Atlas sees the rest. A Chainlink CRE workflow rates Atlas from its real on-chain earnings, and a second workflow checks every agent payment before it is made.

## Status

Built for the TOKEN2049 Origins Hackathon (6–8 October 2026): main track, Cardano Agentic Commerce, and Chainlink CRE. All networks are testnets (Cardano preprod, Base Sepolia).

## Repository layout

```
contracts/cardano   Aiken splitter contract and tests
contracts/evm       AgentRatingRegistry, the CRE consumer on Base Sepolia
workflows/rating    CRE workflow that rates Atlas
workflows/payment-gate  CRE workflow that approves or blocks agent payments
packages/shared     addresses, asset ids, types, Atlas report logic
packages/cardano-tx transaction helpers (script address, distribution, UTxO fan-out)
services/atlas      x402-paid report API
services/coworker   Sokosumi worker for paid Tasks
services/buyer-agent autonomous paying agent, gated by CRE
services/keeper     batches splitter UTxOs and distributes them
apps/web            dashboard
docs/               architecture, write-up, methodology, evidence, threat model
```

## Provenance

Work began on 5 October 2026 with the organisers' approval. That day's setup spikes (toolchain, wallets, x402 starter, a first Aiken validator, CRE hello-world and Blockfrost reads) live in a separate repository. This repository starts at the hackathon build; code carried over from the spikes was rewritten and is credited in `docs/BUILD_LOG.md`.
