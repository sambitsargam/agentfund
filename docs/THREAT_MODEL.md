# Threat model

Who is trusted, what each component actually enforces, and where the gaps are.

## What an investor is trusting

| Party | Trusted for | Why that is acceptable |
| --- | --- | --- |
| The splitter validator | Everything about repayment | It is the only thing that can release locked funds, its rules are in `contracts/cardano`, and its parameters are baked into the address the investor funded |
| Cardano | Execution and finality | — |
| Atlas's operator | Advertising the splitter as its payment address | Not trusted blindly: the payment gate re-derives the address and denies a payment that goes anywhere else |
| The x402 facilitator | Broadcasting a signed transaction | It holds no keys and cannot alter a signed transaction; it also independently re-derives the script address |
| Chainlink CRE | The rating and the payment verdict | Several independent nodes must agree; the verdict is a public on-chain record |
| The LLM auditors | An opinion, never a decision on their own | A malformed or missing answer becomes Review, never Allow; a wrong destination is denied before auditors are consulted |

**Nobody is trusted to forward money.** That is the point: the agent never holds the investor's share.

## What each component enforces

### The splitter (`contracts/cardano/validators/splitter.ak`)

- Sums each governed asset across **all** inputs at its own payment credential, so a batch cannot settle one coin and keep the rest. Tested by `paying_for_one_of_two_inputs_fails`.
- Requires each investor to receive at least `floor(total × bps / 10000)`, summed over however many outputs pay them.
- Requires Atlas to receive at least the remainder, so rounding dust cannot be dropped. Tested by `rounding_dust_cannot_be_dropped` and a property test across randomised totals and shares.
- Accepts any datum or none, so x402 script payments, plain payments and escrow collections are all spendable.
- Rejects share sets over 100% before deployment (`validateDeal`), because the validator would otherwise be unsatisfiable and the funds unspendable.
- Only the first locked input runs the full check; the others return early. The ledger always runs the first one, so the check cannot be skipped — proven by `short_paid_batch_fails_on_first_input`.

### `AgentRatingRegistry` (`contracts/evm`)

- Accepts reports only from the configured Chainlink forwarder.
- Rejects unknown report kinds, scores above 1000, and invalid verdicts.
- Rejects any report not newer than the stored one, and any timestamp more than 5 minutes in the future — so a replayed or back-dated report cannot overwrite a newer one.

### The payment gate (`workflows/payment-gate`)

Runs inside a TEE with a **closed** capability list, so a compromised workflow body cannot reach beyond what one decision needs:

- at most 4 HTTP sends, 1 EVM read, 1 EVM write, 1 consensus report;
- only three named secrets: `blockfrost_project_id`, `auditor_a_key`, `auditor_b_key`.

Its policy fails closed. A wrong `payTo`, a script that does not hash to the deployed validator, a disallowed asset, or an amount over the cap is an immediate **Deny**, decided before any auditor is called. A stale or low rating, an unreachable splitter, a disagreeing auditor, a low-confidence answer or malformed JSON is **Review**. **Allow** requires every check to pass.

### The buyer agent

Pays only on Allow, and only an offer identical to the one approved — same destination, asset, amount, and script hash. If the 402 changes between approval and payment it refuses to pay rather than paying the new terms.

## Known gaps

**Anyone can trigger a distribution, and keeps the leftover ADA.** The validator constrains the governed tokens, not ADA. A settler pays the fee and may keep the min-UTxO ADA that arrived with the payments. This is deliberate — it makes distribution permissionless, so an investor is never blocked by an uncooperative agent — but it means the ADA is a small bounty rather than a protected asset. Mitigation: the keeper runs on a schedule, so there is rarely anything worth taking.

**Escrow collection: closed.** Masumi's selling wallet pays out to its own address by default, which would leave escrow earnings under the operator's control until a keeper swept them into the contract — a window where an investor would be trusting the operator rather than the code. The payment service accepts a script address as the selling wallet's collection address, so we set it to the splitter and escrow payouts now land in the investor contract directly. No sweep, no window.

**The investor set is a script parameter.** Adding an investor produces a different address, so an existing round cannot take a new participant without migrating. A cap-table reference input or share tokens would fix this.

**Ratings are advisory, not collateral.** A high rating does not protect an investor; only the splitter does. The gate uses the rating to decide whether a *buyer* should pay, which is a different question.

**The gate runs on the CRE simulator today.** It executes the real workflow against real services and writes real transactions through the simulation forwarder, but a deployed DON is what makes the decision trust-minimised in production. A consumer trusting the production forwarder must be deployed separately; the registry's forwarder is set at construction.

**LLM auditors can be wrong.** They are deliberately never decisive: they cannot turn a bad destination into an Allow, and anything they get wrong in the cautious direction only causes a Review. An auditor that wrongly approves is caught by the deterministic checks that run first.

**Test networks only.** Everything here uses preprod and Base Sepolia with test money. Mainnet would need an audit of the validator, a funded operations wallet with monitoring, and recalibrated risk weights.
