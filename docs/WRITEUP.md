# AgentFund — Cardano track write-up

## The problem

AI agents are starting to earn money, and they need capital to do it: model credits, data subscriptions, hosting. The obvious deal is revenue sharing — I give you $100 now, you give me 10% of what you earn. The obvious problem is collection. An agent that earns can simply not pay you back, and an investor's only recourse is a legal claim against whoever operates it, which is worth little against a pseudonymous operator running an agent in another jurisdiction for a few hundred dollars.

Every workaround today is a trust assumption. Escrow a lump sum and the agent is capital-constrained again. Hold the agent's wallet keys and you own the agent, not a share of it. Trust a platform to forward the money and you have simply moved the default risk to the platform.

So revenue-share financing for agents barely exists, which is a shame, because an agent's earnings are *unusually* good collateral: every payment is already an on-chain transaction, visible and programmable.

## The approach

AgentFund makes repayment a property of the payment rather than a promise about it. **x402 payments bypass the agent wallet. Masumi escrow earnings require a selling-wallet sweep.** Its advertised payment address is a contract that can only release money by paying each investor their share.

### The splitter

`contracts/cardano/validators/splitter.ak` is a Plutus V3 spending validator parameterised by three things: Atlas's payment key hash, the investors as `(key hash, basis points)`, and the list of `(policy id, asset name)` units it governs. Those parameters are applied to the compiled script, so they are part of the script hash and therefore part of the address. A payment to that address is a commitment to the exact deal that was in force when the money arrived; changing the split produces a different address, and the money already locked stays under the old terms.

Spending is deliberately permissionless — anyone may trigger a distribution — because the validator constrains the *shape* of the transaction rather than who submits it. For each governed asset it:

1. sums that asset across **all** inputs sitting at its own payment credential, so a batch of twenty payments is settled as one amount;
2. requires each investor to receive at least `floor(total × bps / 10000)`, summed across however many outputs pay them;
3. requires Atlas to receive at least `total − Σ investor shares`, so rounding dust is allocated rather than lost;
4. leaves unlisted assets and ADA unconstrained, so min-UTxO ADA and stray tokens cannot brick a spend.

The datum is `Option<Data>` and ignored. This matters more than it sounds: x402's `script` method attaches an inline receipt datum, plain `default` payments attach none, and Masumi escrow collections attach their own. A validator that insisted on a datum shape would reject two of its three income sources.

The EUTXO model is what makes the batching work. Because the validator sees every input in the transaction, one script execution can settle many payments, and because it checks a sum rather than a per-input invariant, the cost of settling twenty payments is close to the cost of settling one.

### Getting paid: two routes, one contract

**x402** (agent to agent). Atlas's paid route answers 402 with the `script` transfer method: `payTo` is the splitter address, `extra.script` is the compiled validator with the deal parameters already applied, and `extra.datum` is a receipt holding the request id. The facilitator independently re-derives the script address from that pre-applied script and refuses the payment if it does not match `payTo` — so the buyer does not have to trust Atlas's claim about where the money is going. Settlement uses `confirmationPolicy: { l1Confirmations: 0 }`; we found the hosted facilitator's gateway times out at 60 s while waiting for a block, which caused a buyer to pay and receive nothing.

**Masumi escrow** (human to agent). Atlas is a Sokosumi Coworker. A paid Task requests signed seller terms from our Masumi payment service, posts the `masumiPayment` event, waits for escrow to be funded on-chain, delivers the report, submits its hash, and collects after the dispute window. Masumi requires a key return address, so collection lands in the operator-controlled selling wallet before the keeper sweeps it into the splitter. Repayment is enforced after that sweep, not before.

### Deciding whether a payment should happen at all

An investor contract is only as good as the agent's willingness to advertise it. A compromised or dishonest agent can quote its own wallet instead. So before a buyer agent pays, a Chainlink CRE confidential workflow checks the offer: that `payTo` is the splitter address bound to this agent, that the script in the offer hashes to the deployed validator, that the asset and amount are within policy, that Atlas's on-chain rating is good and fresh, and that two independent LLM auditors — whose handler is configured for a TEE — judge the offer and a sample of Atlas's work. A wrong destination or script is an immediate Deny; anything unresolved is Review; Allow requires everything to pass. The current CLI simulation writes real testnet transactions but does not establish enclave confidentiality or DON consensus. The verdict is written to Base Sepolia, and the buyer pays only on Allow, insisting that the 402 it finally pays matches the offer that was approved.

## Cardano infrastructure used

- **Aiken** (v1.1.24, stdlib v3.1.0) for the validator; 27 tests, including property tests that assert an exact split always passes and that short-paying an investor by one unit always fails, across randomised totals and share sizes.
- **Plutus V3** with a datum-optional spend, which is what lets the same contract accept x402 script payments, plain payments and escrow collections.
- **EUTXO batching**: the validator reads all script inputs, so one transaction settles many payments. Only the first locked input runs the full check; the rest return early, which took a 10-input batch from 129% of the per-transaction memory limit to 82% in tests, and to a measured 1.7% on-chain.
- **Native tokens**: both preprod tUSDM policies (`e675b46e…` for x402, `16a55b2a…` for Masumi) are governed, so earnings from either route split correctly.
- **x402 `exact` scheme, `script` transfer method**, through the Cardano Foundation's hosted facilitator.
- **Masumi** payment service and registry, and **Sokosumi** for discovery and Tasks.
- **Evolution SDK** for the distribution transactions, and **Blockfrost** plus **Koios** for reads.

## Does it work?

Yes, end to end on preprod, and the dashboard shows it live. A customer agent asked for a report, Chainlink allowed the payment, the buyer paid 0.50 tUSDM into the splitter with the approval's request id in its datum, and the keeper later split it: the investor was paid first, Atlas got the rest. The same flow with a tampered destination was denied and never paid. Every hash is in the README's evidence chain.

## How it scales

**Cost per payment.** Settlement is one script execution over a batch. Measured on preprod: 0.27 tADA to settle two payments, with the full check costing 1.7% of the per-transaction memory budget and each additional input about 0.2%. A batch of eight is safely inside the limit, so the marginal on-chain cost of a payment is roughly 0.03 tADA. The keeper supports manual batches; scheduling remains part of hosting. Batching, so settlement cost is amortised rather than per-payment.

**Throughput.** Atlas's own work is the bottleneck, not the chain: a report takes about 3 seconds and a variable number of public-data requests, including agent identity and counterparty checks. Payment confirmation is 20–60 seconds, which is why the buyer agent fans its wallet out into separate coins — one wallet cannot sign two payments against the same UTxO within a block.

**More investors.** The current validator holds the investor set as a script parameter, which is right for a fixed round but means a new investor creates a new address. The natural next step is a cap-table reference input, or revenue-share receipt tokens minted to investors at funding time so shares are transferable and the validator pays whoever holds the token. The validator's check is already per-investor, so this requires a new validator design and migration; the current validator ignores the datum.

**Beyond one agent.** Nothing in the splitter is specific to Atlas. Any agent with a payment address can be funded this way, and the rating workflow already keys everything by agent id, so one registry serves many agents. The piece that generalises least is the gate's policy, which is deliberately conservative.

## Adoption in the Cardano ecosystem

The pieces we depend on are the ones Cardano is actively building: x402 for agent payments, Masumi for agent identity and escrow, Sokosumi for discovery. AgentFund adds the financing layer on top of them, and it is useful precisely because those payment rails exist. An agent already earning through x402 can adopt this by changing one field — the address it advertises — and its investors are protected from that moment on.
