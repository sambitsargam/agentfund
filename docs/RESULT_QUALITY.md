# Atlas result-quality evidence

## What this upgrade establishes

Atlas v2 gives a sourced preprod history assessment, an explicit next step before payment, and the scope/limitations of the data used. Masumi registry metadata remains visible as identity evidence, but registration never reduces the risk score. Missing core history gives an Unknown result rather than a fabricated age. A missing or conflicting independent balance check tells the user to pause and verify, even when the heuristic score is low.

The score is an index of configured warning signals, not a probability of fraud, a certification of the operator, or a prediction of whether a payment will succeed. A low score does not establish that the intended recipient owns the address. The report tells the user to confirm it separately.

## Reproduce the evaluation

From the application repository:

```bash
npm run evaluate -w @agentfund/shared
npm run test -w @agentfund/shared
# Optional read-only live evaluation; credentials stay in the ignored .env.
node --env-file=.env --import tsx packages/shared/scripts/evaluate.ts --live
```

No evaluation command signs or submits transactions. The live command uses Blockfrost and Koios; it needs a configured Blockfrost project id.

### Synthetic acceptance cases

`packages/shared/test/fixtures/quality-cases.json` contains sixteen manually specified cases with facts, an expected verdict, exact score, expected flags and a reason for that expectation. Expected results are explicit fixture values, not generated from the scoring implementation.

Cases cover an established wallet, a new wallet, an unused address, a contract, registration paired with the same contract/new-wallet/no-stake facts, thin counterparties, source disagreement, unavailable cross-check, missing first or last activity, the low/medium thresholds, and all warning signals together. The same cases run as tests and through the evaluation command.

**Observed: 16/16 acceptance cases passed.** This measures consistency with the published policy and checks known failure conditions. It does not measure precision, recall or fraud-detection accuracy.

Additional report-level tests verify that conflicting or missing balance checks recommend pausing; stake queries disclose their single-address scope; and capped recent history discloses the sample limit.

### Live known-role samples — 6 October 2026

| Subject | Independently known role | Role check | Observed signal score | ADA balance check |
| --- | --- | --- | --- | --- |
| Registered Atlas selling wallet | Masumi registration holder; key address | Passed | Medium, 35/100 | Blockfrost and Koios matched |
| Masumi escrow address | Script address | Passed | Low, 15/100 | Blockfrost and Koios matched |
| Configured test investor | Key address, no Masumi registration | Passed | Medium, 35/100 | Blockfrost and Koios matched |

The roles are drawn from the existing registration, payment-service escrow address and configured investment deal. Scores are observations, not pass criteria. The live check verifies the expected registered/script classifications and records balance-source agreement; it does not label any address fraudulent or safe.

The two known test wallets still receive Medium because of their observed history. This illustrates why youth and thin history are warning signals rather than proof of wrongdoing. The established escrow contract receives Low with an explicit contract-review warning; its score is not an audit of the validator.

Public snapshots, Markdown examples, source endpoints, observation times and machine-readable results are saved in `docs/evidence/atlas-quality/`:

- `acceptance.json`: all synthetic expectations and outcomes.
- `live.json`: known-role checks and balance observations.
- `registered-agent.json` / `.md`: registered-agent report.
- `masumi-escrow.json` / `.md`: contract report.
- `test-investor.json` / `.md`: ordinary test-wallet report.

A browser-verified production preview of the updated report was captured in `dashboard.png`. The local review preview runs on port 3100; existing long-running services still need to load the new build at their next controlled restart.

Snapshots change when the live command is rerun. They represent a point in time; indexers can lag and balances can change between requests.

## What remains unvalidated

- No labelled scam/benign dataset, measured false-positive rate or calibrated probability exists.
- Matching two ADA balances validates that field; it does not validate every report fact or the final verdict.
- Counterparty co-occurrence in a transaction is not proof of direct trade or ownership. At most eight transactions and three co-occurring addresses are examined.
- Stake-address queries check the first indexed payment address, not the whole stake account. Recent counts may be lower bounds when the 100-transaction window is full.
- Registry metadata records operator claims. Credentials, current marketplace availability and real-world authorship are not certified by this check.
- Real customer usefulness and willingness to pay still need user feedback. Three sample reports do not establish demand.

## References used

Implementation used the installed `masumi` skill, specifically `.claude/skills/masumi/references/registry-identity.md` (permissionless registry and NFT metadata), and the bundled Cardano documentation `cardano-dev-skills/docs/sources/masumi/core-concepts/registry.mdx` and `identity.mdx`. These distinguish on-chain registry identity from a general safety endorsement. No SDK versions, payment terms or deployed contracts changed.

## External threat diagnostic and warning labels

See [CARDANO_HARDENING.md](CARDANO_HARDENING.md). Six distinct maintainer-reported threat addresses were researched from a pinned public Cardano registry; partial public histories produced zero high warnings. The result is evidence of limitations, not validated fraud accuracy. No legitimate control cohort or independent fraud outcome labels are available. Free mainnet checks expose exact public-source matches separately; no match means unknown. Paid report warnings are explicitly experimental and unvalidated.
