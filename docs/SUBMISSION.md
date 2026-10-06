# AgentFund — submission reference

One page with every identifier, transaction and link a judge needs. Everything is testnet:
**Cardano preprod** and **Base Sepolia**. No mainnet value is involved anywhere.

## What it is

Investors fund an AI agent in exchange for a share of its future earnings. Repayment is
enforced at the payment itself: the agent's advertised payment address _is_ a Cardano
validator that cannot release funds without paying each investor their share first.
Chainlink CRE decides whether each agent payment is safe before it happens.

The agent is **Atlas**, a Cardano counterparty due-diligence Coworker. You paste an address
you are about to pay and it tells you who is behind it — a person, a contract, or a
registered AI agent — with its history, the wallets it deals with, and what it could not
determine. Teams hire it on Sokosumi through Masumi escrow; other agents pay it per report
over x402. Both pay in tUSDM, and both land in the splitter.

## Links

|                                           |                                                                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Repository                                | https://github.com/sambitsargam/agentfund                                                                                   |
| Live dashboard                            | _(filled in at deploy)_                                                                                                     |
| Deck (.pptx, Google Drive)                | _(filled in at deploy)_                                                                                                     |
| Demo video (≤3 min, embedded in the deck) | _(filled in at deploy)_                                                                                                     |
| Write-up                                  | [docs/WRITEUP.md](WRITEUP.md)                                                                                               |
| Architecture                              | [docs/ARCHITECTURE.md](ARCHITECTURE.md)                                                                                     |
| How the verdict is produced               | [docs/METHODOLOGY.md](METHODOLOGY.md) · [docs/RESULT_QUALITY.md](RESULT_QUALITY.md)                                         |
| What we do not claim                      | [docs/THREAT_MODEL.md](THREAT_MODEL.md)                                                                                     |
| Independent settlement check              | [docs/VERIFICATION.md](VERIFICATION.md) · [docs/samples/settlement-verification.json](samples/settlement-verification.json) |

## Contracts and addresses

| Thing                                               | Value                                                                                                                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Splitter validator (Aiken, Plutus V3)               | [`addr_test1wzyukctzs3agkmx9gt85dp2ftu9622k8926qh7kjhlw3z8s7w0h96`](https://preprod.cardanoscan.io/address/addr_test1wzyukctzs3agkmx9gt85dp2ftu9622k8926qh7kjhlw3z8s7w0h96) |
| Splitter script hash                                | `89cb6162847a8b6cc542cf4685495f0ba52ac72ab40bfad2bfdd111e`                                                                                                                  |
| Atlas operator wallet                               | `addr_test1qrseuc9dfg2qdn7vkg35lxnpzjk4y67nemcmmkc2k5t2yk6ddv3uplh7wk4p468pte5fpxgckpmuu2jcuk5vr2qpgz2q7gyegt`                                                              |
| Investor A (1000 bps = 10%)                         | `addr_test1qqwdk97gwef6ypkjcd9hhgpls8ela9fdvee2wvaxnkmjqdtj5pvye96gvjtm2jv70mtyqsczypsl8f2d3dgtlcmktk0sv74rjj`                                                              |
| x402 tUSDM policy                                   | `e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9`                                                                                                                  |
| Masumi tUSDM policy                                 | `16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde`                                                                                                                  |
| tUSDM asset name                                    | `0014df10745553444d`                                                                                                                                                        |
| Rating registry (Base Sepolia)                      | [`0xee171354e30f24428eEaAaDA952eEC7479b08131`](https://sepolia.basescan.org/address/0xee171354e30f24428eEaAaDA952eEC7479b08131)                                             |
| x402 facilitator (hosted by the Cardano Foundation) | `https://x402.preprod.dev.ecosyseng.cf-deployments.org`                                                                                                                     |

The splitter's script hash derives identically three ways — our own TypeScript builder, the
facilitator's pre-applied-script path, and `aiken blueprint apply` — which is what lets the
facilitator settle a payment straight into it.

## Cardano Agentic Commerce track

### Required: an x402 payment through the hosted facilitator

| What                                                                  | Evidence                                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Agent pays Atlas 0.50 tUSDM, report delivered (HTTP 200, 43.2 s)      | [`76abb642…7dfb`](https://preprod.cardanoscan.io/transaction/76abb642c411ff657f5a030e94d415468ba0d1123bfe7f6e158894c5bddd7dfb) |
| Earlier attempt, settled on-chain but `/settle` returned 504          | [`6704121e…8999`](https://preprod.cardanoscan.io/transaction/6704121ed5da8736605f52794896fca5e29de2e617d7fe78cbae59760b8b8999) |
| Gate-approved payment (request `0xd5cefbdb…e495` in its inline datum) | [`3efa54df…59ba`](https://preprod.cardanoscan.io/transaction/3efa54df70e619e349db20ce5e925ebdb6c771e76131bfd485071dac871d59ba) |

Both used the `exact` scheme with `assetTransferMethod: script`, so the money went into the
validator rather than a wallet. The 504 is kept in the record because it is why we settle at
`l1Confirmations: 0`.

### Required: the Coworker path, end to end

| What                             | Value                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Coworker ID                      | `01a10f48-cd2e-7408-b1f2-493af98854af`                                                                                          |
| Masumi registration (`Standard`) | `cmuwev0io001e57ujoe49a0y3`, state `RegistrationConfirmed`                                                                      |
| Registry policy                  | `67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b`                                                                      |
| Agent URL                        | _(filled in at deploy)_                                                                                                         |
| Sample Task                      | `01a11053-0ffc-75dd-bad7-1e6b98910cc8` — _"We are about to send 2000 tUSDM to addr_test1qrseuc9…. Is this wallet safe to pay?"_ |
| Payment event                    | `01a11053-273e-7618-a381-9ff4e3b2c4e3`                                                                                          |
| Completion event                 | `01a11068-18b3-72fb-a158-04db6ea15d87`                                                                                          |
| Result hash submitted to escrow  | `6f4883be577139ae4571bf0779ad20954db6eecd09c6a985c22c9337b31ac127`                                                              |

**The collection, and what happened to the money afterwards.** The Masumi team asked for the
collection transaction, noting that a `PURCHASED` claim does not prove the seller was paid.
Here is the whole path, each step a separate confirmed transaction:

| Step                                | Transaction                                                                                                                     | Effect                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1. Escrow releases to the seller    | [`216f781a…f34b`](https://preprod.cardanoscan.io/transaction/216f781ace511d1f4e690ea3633916b03d7289950601a4ff99e4fa6eaf12f34b)  | 1.00 Masumi tUSDM leaves the escrow script `addr_test1wzs4e6w…` and reaches the selling wallet |
| 2. Keeper sweeps into the splitter  | [`100acc17…b94ac`](https://preprod.cardanoscan.io/transaction/100acc1782a1f9f35525db7ef8db5f10acceb07f541292038ef2cb90692b94ac) | the same 1.00 tUSDM moves from the selling wallet into the validator                           |
| 3. Splitter pays the investor first | [`a58888e1…41b5`](https://preprod.cardanoscan.io/transaction/a58888e10d7a20ff73dcd33f23902d0994de8fbddfe48df573173a0f088141b5)  | Investor A receives 0.10 Masumi + 0.05 x402 tUSDM; Atlas receives 0.90 and 0.45                |

Every input and output of all three is recorded in
[docs/samples/settlement-verification.json](samples/settlement-verification.json), read back
from Blockfrost rather than from our own logs.

### Funding a round

| What                                                  | Transaction                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Investor sends capital for the 10% share              | [`d9d65fc3…4af7`](https://preprod.cardanoscan.io/transaction/d9d65fc3153abf6a59ed3f7c108b9f67f12e3ca46c06dff3a063232fb5c74af7)  |
| A later payout to that investor out of earned revenue | [`9d24049c…5277e`](https://preprod.cardanoscan.io/transaction/9d24049c2da62f836f7d385cdd7c377c9be29642188efbc8534a8e8c49d5277e) |

The first on-chain split, for reference:
[`075142c0…6c08`](https://preprod.cardanoscan.io/transaction/075142c03ca67a90de253149cdc0a32f80a0b658463f2879cdca2661e70c6c08)
— 1.7% of the per-transaction memory limit for the first input, measured on chain.

### A complete funding round, paid by a real customer

The splitter above enforces a share that is a fixed script parameter. A **funding round**
(`contracts/cardano/validators/funding_round.ak`) is the whole lifecycle instead: the
investor's share is inactive until their capital reaches the operator, cumulative payouts are
tracked in the round's datum, and the round closes itself once the cap is repaid.

Terms: **0.20 tUSDM** of capital for **50%** of this agent's x402 earnings, repaid up to a
**0.30 tUSDM** cap. Round address
[`addr_test1wrmq8ggvrej7fwrt4ud652ajglw5x9permf8el96lyvaj3cjceryd`](https://preprod.cardanoscan.io/address/addr_test1wrmq8ggvrej7fwrt4ud652ajglw5x9permf8el96lyvaj3cjceryd).

| #   | Step                  | Transaction                                                                                                                    | Investor (tUSDM) | Operator (tUSDM) |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------- | ---------------- |
| 1   | round opened          | [`9b693f3d…6983`](https://preprod.cardanoscan.io/transaction/9b693f3d8c1a224e97621a71a77992874b119ca67297849ab29f49f06e996983) | +0.00            | +0.00            |
| 2   | investor funds it     | [`d4889d9a…03ea`](https://preprod.cardanoscan.io/transaction/d4889d9a24115877830d34c8a23a05c876480a3a7e2dc6cb62d9f32cac7903ea) | -0.20            | +0.20            |
| 3   | customer x402 payment | [`6a6b56ae…c56a`](https://preprod.cardanoscan.io/transaction/6a6b56ae1156fa82c3cf649dcebd0896c053c6a7a404fd2b4742a3f1bcd5c56a) | +0.00            | +0.00            |
| 4   | payout                | [`6b7328e5…1491`](https://preprod.cardanoscan.io/transaction/6b7328e57a9e38a0d914e113573c258422ca02c0cf5bc4d0986023a87c9f1491) | +0.25            | +0.25            |
| 5   | customer x402 payment | [`df04f4cc…a6c1`](https://preprod.cardanoscan.io/transaction/df04f4cc5f7cea4f6b860aade7e020c9c09506486abab498882f19f05feba6c1) | +0.00            | +0.00            |
| 6   | payout                | [`719c42d4…ce9e`](https://preprod.cardanoscan.io/transaction/719c42d49df389758f3b6eb36cd1d1c4029d61e0b1e13958d1fae28c058cce9e) | +0.05            | +0.45            |

Two things make this more than a demonstration of arithmetic.

**The revenue is a real customer payment.** Steps 3 and 5 were paid by a buyer agent's own
wallet (`addr_test1qpqw23u…`) against Atlas's x402 offer for `/rounds/<id>/report`, each
carrying its receipt as an inline datum. The money went from the customer into the round's
address directly — it never passed through Atlas's wallet, so there is no step at which the
operator could have declined to forward it.

**The cap is enforced, not calculated.** Step 4 pays the investor a full 50% share, 0.25. Step
6 pays only **0.05**, because that is all that remained under the 0.30 cap, and the round
closes. The validator rejects any transaction that pays more.

Total repaid: 0.30 tUSDM against a 0.30 tUSDM cap, for 0.20 tUSDM of capital. Every figure is a net
flow re-derived from Blockfrost with `npm run verify-round -w @agentfund/keeper -- <id>`,
which refuses to write its evidence file if repayments ever exceed the cap. Full record:
[docs/samples/round-f603a10c-verification.json](samples/round-f603a10c-verification.json).

An earlier round ran the same lifecycle with revenue paid in by the operator rather than a
customer: [docs/samples/round-verification.json](samples/round-verification.json).

Investors can open and fund a round from the dashboard with a Cardano wallet. The server
builds an unsigned transaction and stores it, the wallet signs it, and the server submits it;
no key material reaches the browser or the server.

## Chainlink CRE track

CRE is the orchestration layer, not a bolt-on: the payment gate is what decides whether a
payment happens at all, and the buyer agent has no path to pay without an ALLOW.

| What                                                                         | Evidence                                                                                                                |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Rating registry deployed                                                     | [`0x27bf50e2…0e02`](https://sepolia.basescan.org/tx/0x27bf50e25bb91b0fff094f6a0ef961e6b19bc9613a47f8ab39b4102a32f70e02) |
| Gate **ALLOW** (flags 0, rating 385)                                         | [`0x95bd73aa…3a5a`](https://sepolia.basescan.org/tx/0x95bd73aa0c306b64294145e27908c9758f77deb166d38313021ea1ce2ff43a5a) |
| Gate **DENY** — `payTo` swapped to another wallet (flags 1, `payToMismatch`) | [`0xc625f8ae…ba39`](https://sepolia.basescan.org/tx/0xc625f8ae1158732948d79b209f64331efa8b087dba5fa86985725883f07aba39) |
| Rating refresh, so the gate's freshness rule holds                           | [`0x3ffd2c9e…b9b7`](https://sepolia.basescan.org/tx/0x3ffd2c9e96cb116361aeaf0ca0f60e27654e0c060a79794f2a9b7b9a391db9b7) |
| Logs and simulation output                                                   | [docs/CHAINLINK_EVIDENCE.md](CHAINLINK_EVIDENCE.md), `docs/evidence/*.log`                                              |

Two workflows:

- **`rate-atlas`** (cron + HTTP handler) reads Atlas's real earnings on Cardano through
  Blockfrost, probes its service, and writes a signed rating to Base Sepolia. Consensus is
  `ConsensusAggregationByFields` with `median` over the numeric fields. It skips an unchanged
  write but heartbeats every 30 minutes so `observedAt` never goes stale.
- **`gate`** runs in a **TEE** (`handlerInTee`). It checks the rating is good and fresh, that
  the money is going into the investor splitter and not a wallet, and that the asset and
  amount match the offer; then two independent LLM auditors must agree. The verdict is written
  on-chain as ALLOW / DENY / REVIEW, and the deny path fails closed.

The DENY above is the honest centre of the demo: the offer is tampered with so the money
would reach a wallet instead of the splitter, and the gate refuses before any payment exists.

## How to run it

See [docs/OPERATIONS.md](OPERATIONS.md). `npm test` runs 111 tests; `aiken check` in
`contracts/cardano` runs 251 checks including property tests and on-chain budget bounds;
`forge test` runs 11.

## What is proven, and what is not

Stated plainly, because a judge will ask.

**Proven on-chain.** Payments from both routes land in a validator the operator does not
control. The validator cannot release funds without paying each investor their share — this
is enforced by the script, not by our service. The gate blocks a redirected payment before it
is made. A paid Sokosumi Task ran to completion, the escrow released, and the money reached
the investor; every hop has a transaction hash above.

**Not proven.** Atlas's risk verdict is _not_ a validated fraud classifier. It reports
history, registration and counterparty facts with its sources and its gaps; we have never
measured it against labelled fraud outcomes, and a six-address check against a pinned public
threat list produced no high warnings, which we report rather than hide. There is no accuracy
figure in the product, and the UI says so where it matters.

**A real gap.** Masumi escrow can only release to a wallet with a payment key, not to a
script, so Masumi earnings reach the splitter via an operator-signed sweep. Until that
transaction is made, those particular funds are in the operator's custody. x402 payments have
no such gap — they go straight into the validator. We do not claim protocol-enforced
repayment for the Masumi route, and [docs/THREAT_MODEL.md](THREAT_MODEL.md) explains it.

**Scope of the demand evidence.** The investor and the paying agents are our own test wallets.
One paid Task has completed and collected. That demonstrates the machinery works end to end;
it is not evidence of customer demand, and we do not present it as such.

Atlas's own day-to-day revenue still flows through the splitter; the funding round above is a
separate, completed deal that demonstrates the lifecycle end to end.
