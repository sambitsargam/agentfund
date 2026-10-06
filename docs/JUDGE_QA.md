# Judge Q&A

Short, honest answers to the questions we expect. Where the answer is "we have not proven
that", it says so. Evidence links live in [docs/SUBMISSION.md](SUBMISSION.md).

### What stops Atlas from just keeping the money?

Atlas never holds it. The address Atlas advertises in its 402 response _is_ the splitter
validator, and the validator's spending condition requires that each investor receives at
least `floor(total × bps / 10000)` of every governed asset in the same transaction. Atlas can
sign whatever it likes; a transaction that short-pays an investor is rejected by the ledger.
Atlas cannot change the advertised address either without changing the script hash, which the
facilitator re-derives from the 402 itself.

### So repayment is fully enforced?

For x402 payments, yes — they land in the validator directly. For Masumi escrow, no, and we
will not claim otherwise. Masumi's escrow releases only to an address with a payment key
credential, not to a script, so those earnings arrive in the operator's selling wallet and a
keeper transaction sweeps them into the splitter. Between release and sweep they are in the
operator's custody. That is a real trust gap, it is documented in
[docs/THREAT_MODEL.md](THREAT_MODEL.md), and closing it needs a change on Masumi's side.

### What if the keeper never runs?

Then the funds sit in the splitter and nobody is paid, including Atlas — the validator holds
both sides. The keeper has no privilege: anyone can build and submit a valid distribution,
because the only transaction the script accepts is one that pays the investors correctly. So
the keeper is a convenience, not a trusted party. It persists its state before each side
effect and reconciles submitted hashes on restart, so an ambiguous broadcast is never blindly
retried.

### Is Chainlink doing real work, or is it decoration?

The gate is the thing that decides whether a payment happens. The buyer agent pays through a
selector that only accepts an offer identical to the one the gate approved — same `payTo`,
asset, amount and script hash — so with no ALLOW there is no payment. The tamper demo is the
proof: redirect the payment to a wallet and the gate returns DENY with `payToMismatch` before
any transaction exists.

Mechanically it is an orchestration layer across three systems: EVM read of the rating, HTTP
to Blockfrost for Cardano state, two LLM auditors inside a TEE, then an EVM write of the
verdict. Remove it and the payment path loses its only pre-flight check.

### You write the rating yourself. Isn't that self-dealing?

The rating workflow reads facts it does not control — Atlas's earnings on Cardano via
Blockfrost, and a live probe of its service — and the DON reaches consensus on them with a
median across nodes. We wrote the workflow, as every CRE user does; we cannot forge the
inputs or sign a report alone. What it is _not_ is an independent credit rating: it is a
freshness-and-liveness signal about one agent, and the registry's replay check and the gate's
one-hour freshness rule are what make it meaningful rather than decorative.

### Two LLM auditors will just agree with each other.

Largely true, and we should not oversell it. Two prompts against the same model family are
correlated, so they catch an obviously bad proposal, not a subtle one. They are the last and
weakest of the gate's checks. The deterministic rules in front of them — payTo, script hash,
asset, amount, rating freshness — are what actually stop the attack in the demo, and they fail
closed. We kept both auditors because the deny bitmask distinguishes their disagreement from a
rule violation, which is useful in the logs.

### How do you know the risk verdict is correct?

We don't, and the product says so. Atlas is not a validated fraud classifier. It reports what
the chain says — age, transaction count, balance, script or wallet, staking, whether the
address holds a Masumi registration NFT and what that registration claims, and whether its
main counterparties have any history of their own — each with its source and its gaps. When
core history is missing it returns Unknown rather than a low-risk label, and it pauses the
recommendation when two data sources disagree on the balance.

We have never measured it against labelled fraud outcomes. A diagnostic over six addresses
against a pinned public threat list produced zero high warnings; we publish that because it
weakens the claim. There is no accuracy number anywhere in the product, deliberately.

### Then what is Atlas actually useful for?

Answering "who is this address, and what can I establish before I send money" in seconds
instead of fifteen minutes across explorer tabs. The one thing it does that an explorer cannot
is tell you an address is a registered AI agent, who authored it, what service it sells and
what endpoint it advertises — read from the Masumi registry on-chain — and then check whether
the wallets it actually deals with have any history. That is a sourced identity-and-context
check, not a safety guarantee, and that is how it is worded.

### Who pays for this, and why now?

Two buyers, both already paying in the demo. Agents that are about to send money buy a check
for 0.50 tUSDM over x402 — cheap insurance against paying the wrong address, and the reason
this matters now is that agents are starting to hold and send funds without a human in the
loop. Teams hire Atlas on Sokosumi through Masumi escrow and get the same report in their
chat thread.

Honest limit: both the investor and the paying agents in our demo are our own test wallets.
One external paid Task has completed and collected. We have evidence the machinery works end
to end, and no evidence of customer demand.

### Isn't this just a payment splitter?

The splitter is the enforcement primitive, not the product. The product is the claim that an
agent's future earnings can be financed, because the repayment is structural rather than
promised: the share is taken at the moment of payment, by the script, from money the agent
never touches. The funding-round validator adds the rest of the lifecycle — an investor's
entitlement activates only once their capital reaches the operator, and the round stops taking
a share once cumulative payouts reach the cap.

### Is the validator safe? What about double satisfaction?

Inputs are identified by payment credential and the full whole-transaction check runs on the
first locked input only, which the ledger always executes; the remaining inputs return early.
That took a 10-input batch from 129% of the memory limit to 82% in tests, and the measured
on-chain cost for the first input is 1.7% of memory. 251 Aiken checks cover multi-input
batches, rounding, a `None` datum, an outsider attempting to spend, short payments, and
budget bounds at 1, 5, 10 and 20 inputs. The keeper batch cap is 8.

### What is the weakest part of the project?

Demand evidence. The mechanism is real and on-chain; the risk product rests on shallow
heuristics with no measured accuracy; and the investor side has exactly one participant, who
is us. If we had another week it would go to validating report outputs against independently
checked examples — including mismatches and missing data — and to putting the thing in front
of people who pay for counterparty checks today.

### Why Cardano?

The enforcement only works because a payment can be made _to a script_ that constrains how it
is spent, and because EUTXO lets one transaction settle several received payments at once with
the split checked over the whole transaction. Native tokens mean tUSDM moves without a token
contract in the path. x402's `script` asset transfer method and the Cardano Foundation's hosted
facilitator make the advertised address a validator rather than a wallet, which is the whole
trick.

### What is not finished?

Atlas's day-to-day revenue still flows through the fixed splitter; the funding round is a
separate completed deal rather than the live path for every payment. The CRE workflows run
through CLI simulation with real testnet writes rather than a DON deployment. The Masumi sweep
gap above is unclosed by design, not by omission.
