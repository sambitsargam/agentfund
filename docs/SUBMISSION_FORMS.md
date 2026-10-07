# Submission forms — paste-ready text

Three tracks, three forms. Everything below is text to paste; the links table at the
bottom collects what each form asks for. Figures are the verified ones: 53 Aiken tests
(251 checks), 168 workspace tests, 11 Foundry tests.

---

## 1 · Main track

### One-line pitch

Revenue-share financing for AI agents: investors get paid before the agent does, because
the agent's payment address is a contract that cannot release money any other way.

### What it does

An AI agent that earns money needs capital — model credits, data, hosting — and revenue
sharing is the natural deal. Collection is the part that does not work. An investor's only
recourse against a pseudonymous operator over a few hundred dollars is a legal claim worth
less than the debt, so agent financing barely exists, even though agent earnings are
unusually good collateral: every payment is already an on-chain transaction.

AgentFund makes repayment a property of the payment rather than a promise about it. The
address our agent advertises for payment is not a wallet but a Cardano validator that can
only be spent by paying each investor their share first. Because the investor set and the
split are script parameters, they are part of the script hash and therefore part of the
address: a payment to that address is a commitment to the exact deal in force when the
money arrived.

On top of that sits a funding round — a full lifecycle rather than a fixed share. The
investor's share does not exist until their capital reaches the operator, cumulative
payouts are tracked in the round's datum, and the round closes itself once the repayment
cap is reached. The validator rejects any transaction that pays beyond the cap.

A Chainlink CRE confidential workflow decides whether a payment should happen at all,
because an investor contract is only as good as the agent's willingness to advertise it.
Before a buyer agent pays, the workflow checks that the destination is the right contract,
that the script in the offer hashes to the deployed validator, that the asset and amount
are within policy, and that the agent's on-chain rating is good and fresh. The buyer pays
only on Allow, and only the exact offer that was approved.

### What is actually working

A funding round opened, was funded by an investor wallet, earned revenue from real x402
purchases, repaid the investor first, was trimmed to its cap and closed itself — all on
Cardano preprod, every step a public transaction. A second round is open and funded right
now on the live dashboard. A payment with a tampered destination was denied by the
Chainlink workflow and never made.

### Honest scope

Test networks only: Cardano preprod and Base Sepolia. The investor wallet and the paying
buyer agent are ours, so this demonstrates the mechanism, not outside demand — the
dashboard makes the same distinction. The Chainlink gate sits in front of the buyer
agent's purchases, not in front of the agent's own endpoint. The CRE workflows run through
the CRE CLI simulator against real services and write real testnet transactions; that does
not establish enclave confidentiality or DON consensus in production.

---

## 2 · Cardano Agentic Commerce track

Full write-up: `docs/WRITEUP.md` — paste that document. It covers the problem, the
validator design, both income routes (x402 and Masumi escrow), the Chainlink gate, the
Cardano infrastructure used, whether it works, and how it scales.

### Cardano infrastructure used

- **Aiken** v1.1.24, stdlib v3.1.0 — two Plutus V3 validators: a fixed-share splitter and
  a funding round with capital activation and a repayment cap. 53 tests, two of them
  property tests over 100 randomised cases each; `aiken check` reports 251 checks, 0 errors.
- **Plutus V3, datum-optional spend** — which is what lets one contract accept x402 script
  payments, plain payments and Masumi escrow collections. A validator that insisted on a
  datum shape would reject two of its three income sources.
- **eUTxO batching** — the validator sums each governed asset across all of its own script
  inputs, so one execution settles many payments. Measured on chain: 1.7% of the
  per-transaction memory budget for the first input, about 0.2% per additional input.
- **x402** `exact` scheme with the `script` transfer method, through the Cardano
  Foundation's hosted facilitator, pinned at `@x402/*` 2.26.0.
- **Masumi** payment service and registry, and **Sokosumi** for discovery and paid Tasks.
- **Evolution SDK** for transaction building; **Blockfrost** and **Koios** for reads.

### Why the eUTxO model matters here

Because the validator sees every input in the transaction, it can check a sum rather than a
per-input invariant, so settling twenty payments costs close to what settling one costs.
And because the deal is a script parameter rather than mutable state, money already locked
stays under the terms it arrived under — changing the split produces a different address.

---

## 3 · Chainlink CRE track

Full evidence, with every transaction hash and simulator log: `docs/CHAINLINK_EVIDENCE.md`.

### How CRE is used

Two workflows, not one, and both make decisions rather than only reporting.

**Rating workflow** (cron + HTTP triggers). Reads the agent's real earnings from Cardano
through Blockfrost, probes the live agent over HTTPS, and the DON agrees on the
observation by median before a signed rating is written to `AgentRatingRegistry` on Base
Sepolia. Writes are skipped when nothing changed.

**Payment gate** (HTTP trigger, confidential workflow). Started from Chainlink's
`ai-audit-firewall-ts` template: `handlerInTee`, a closed-capability `preHook`, secrets
read inside the enclave, and `usingTheDons()` for the chain read and the report write.
Rebuilt around our proposal, policy, auditors and registry. It checks the payment
destination, the script hash in the offer, the asset and amount, and rating freshness;
then two independent LLM auditors judge the offer and a sample of the agent's work. A
wrong destination or script is an immediate Deny, anything unresolved is Review, and
Allow requires everything to pass. The verdict is written on-chain, and the Cardano
payment that follows carries the gate's request id in its inline datum, so an approval
and its payment can be matched afterwards.

### Evidence

- Registry on Base Sepolia: `0xee171354e30f24428eEaAaDA952eEC7479b08131`
- Allow, then the Cardano payment carrying its request id:
  `0x95bd73aa…3a5a` → `3efa54df…59ba`
- Tampered destination denied before any money moved: `0xc625f8ae…ba39`
- Ten documented runs including dry runs, mock and real LLM auditors, a Review outcome we
  did not hide, and runs against the hosted agent. All reproducible in one take with
  `scripts/demo-cre.sh`.

### Honest scope

Runs are `cre workflow simulate` (CRE CLI v1.36.0) against real services and real Base
Sepolia transactions through the simulation forwarder. That demonstrates the workflow and
its on-chain effects; it does not by itself establish TEE confidentiality or production DON
consensus. The gate protects the buyer agent's purchases, not the selling agent's endpoint.

---

## Links for every form

|                       |                                                              |
| --------------------- | ------------------------------------------------------------ |
| Repository            | https://github.com/sambitsargam/agentfund                    |
| Live dashboard        | https://agentfund-six.vercel.app                             |
| Agent (x402 endpoint) | https://atlas-production-c76c.up.railway.app                 |
| Deck (Google Drive)   | _(fill in after upload)_                                     |
| Cardano demo video    | _(fill in — 2:43, under the 3-minute limit)_                 |
| Main demo video       | embedded in the deck on slide 6 (not linked)                  |
| Chainlink demo video  | _(fill in — 1:34)_                                           |
