# Deck outline

12 slides, built as **.pptx** or **.keynote** and uploaded to Google Drive. The 3-minute recording is embedded on slide 6 — not linked, embedded. Google Slides, Gamma and Vercel links are rejected.

Design: dark, the same palette as the dashboard (near-black `#0a0b0d`, gold `#e9b949`, teal `#3ddc97`, red `#ff6b5e`). One idea per slide. Screenshots from the live dashboard, never mock-ups.

---

### 1 · Title

**AgentFund** — Investors get paid before the agent does.

Subtitle: Revenue-share financing for AI agents, enforced on Cardano, policed by Chainlink.
Footer: TOKEN2049 Origins Hackathon · Main · Cardano Agentic Commerce · Chainlink CRE

---

### 2 · The problem

> An AI agent that earns money can simply not pay you back.

- Agents need capital: model credits, data, hosting.
- Revenue sharing is the natural deal.
- Collection is the broken part. Suing a pseudonymous operator over $200 is not a plan.
- So agent financing barely exists — even though agent earnings are unusually good collateral, since every payment is already an on-chain transaction.

---

### 3 · The idea

> Don't ask the agent to pay you back. Don't let it hold the money.

The agent's advertised payment address is a contract. It can only release funds by paying each investor their share first.

*Visual: the money-flow diagram from the dashboard.*

---

### 4 · How it works

Three systems, one job each:

| | |
| --- | --- |
| **Cardano** | Enforces repayment. The deal is inside the script hash, so it cannot change after funding. |
| **Chainlink CRE** | Decides whether a payment should happen at all, before any money moves. |
| **Masumi + Sokosumi** | Give the agent an identity and real paying customers. |

*Visual: the architecture diagram from the README.*

---

### 5 · Meet Atlas

The first funded agent: a Cardano counterparty due-diligence Coworker.

- Paste a wallet address before you send money to it; get a plain-language verdict with the facts, the method, and links to the public record.
- For treasury, payments, grants and OTC teams.
- Two income routes, one contract: teams hire it on Sokosumi (Masumi escrow → selling wallet → keeper sweep), agents pay per report (x402).

*Visual: a real report, the one from the event workspace.*

---

### 6 · Demo

**Embedded 3-minute recording.** (`docs/DEMO_SCRIPT.md`)

Caption under the video: every transaction shown is live on Cardano preprod and Base Sepolia.

---

### 7 · The contract that makes it work

```
splitter(atlas, investors[(key, bps)], assets[(policy, name)])
```

- Sums each asset across **all** script inputs, so a batch cannot pay for one and pocket the rest.
- Every investor gets at least `floor(total × bps / 10000)`; Atlas gets the remainder, so rounding dust is never lost.
- Datum-optional, which is why x402 payments, plain payments and escrow collections all work.
- 27 tests, including property tests over randomised totals and shares.
- Measured: 1.7% of Cardano's per-transaction budget for the full check; batches of 8 settle at ~0.03 ADA per payment.

---

### 8 · Chainlink as the orchestration layer

Not a price feed — the thing that decides.

| Workflow | Trigger | Does |
| --- | --- | --- |
| Rating | cron + HTTP | Reads real earnings from the contract via Blockfrost, probes the agent, agrees across nodes, writes a signed rating |
| Payment gate | HTTP, **TEE handler; CLI simulation today** | Checks destination, contract hash, rating freshness and two AI auditors — then writes Allow / Deny / Review |

Enclave confidentiality and DON consensus remain deployment work; the demo proves local simulation with real testnet writes. The buyer pays only on Allow, and only the exact offer that was approved.

*Visual: the DENY row from the dashboard with its Basescan link.*

---

### 9 · It works, and here's the receipt

The evidence chain, every link a real transaction:

hosted-facilitator payment → Chainlink Allow → payment into the contract (carrying the approval id) → split, investor first → rating written → **tampered payment blocked**

*Visual: the README evidence table, with hashes legible.*

---

### 10 · Market (for the investor in the room)

- Who pays today: treasury, payments, grants and OTC teams checking a counterparty before sending funds — the same job a compliance analyst does by hand.
- Who pays tomorrow: the agents themselves. Agent-to-agent payments need agent-to-agent due diligence, and that market only exists because x402 made per-request payment possible.
- Our business model is the financing layer, not the report: AgentFund takes a fee on funded agents' earnings, and the mechanism works for any agent with a payment address.
- Why now: x402 on Cardano shipped weeks ago, Masumi gives agents identity and escrow, and CRE makes off-chain decisions enforceable on-chain. None of this was possible last year.

---

### 11 · Roadmap

- **Next:** revenue-share receipt tokens so investor shares are transferable, and a repayment cap so a deal closes itself.
- **Then:** a second funded agent to prove the mechanism is not Atlas-specific, and direct escrow collection into the contract.
- **Later:** mainnet, after an audit of the validator.

---

### 12 · Close

> Agents are about to become a real part of the economy. They will need capital, and the people who provide it will need to get paid.

Links: live dashboard · public repo · Sokosumi Coworker `Atlas` · contract addresses on both chains.

---

## Submission checklist

- [ ] Deck exported as **.pptx or .keynote**, uploaded to Google Drive, link sharing on
- [ ] 3-minute recording **embedded in the deck**, not linked
- [ ] Repo public, README's evidence links all resolving
- [ ] Live URL reachable from a phone
- [ ] Cardano: preprod prototype, docs, ≤3-minute video, write-up, hosted-facilitator payment hash, Coworker ID, sample Task, Task ID, payment event IDs, collection tx hash
- [ ] Chainlink: simulation output, logs and transaction hashes in `docs/CHAINLINK_EVIDENCE.md`
- [ ] Submitted to all three tracks by the internal target of **Wednesday 7 October, 9pm SGT** (brief deadline: 11:59pm SGT)
