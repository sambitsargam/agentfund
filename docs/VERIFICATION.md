# Verification phase — 6 October 2026

This phase verifies the local prototype and completes the paid Task evidence. Hosting, final media and submission remain the final stage. No deployment, commit or push was performed.

## Confirmed paid Sokosumi Task

- Task: `01a11053-0ffc-75dd-bad7-1e6b98910cc8`
- Purchase/payment event: `01a11053-273e-7618-a381-9ff4e3b2c4e3`
- Completion event: `01a11068-18b3-72fb-a158-04db6ea15d87`
- Local task state: settled, report delivered, escrow Withdrawn; current registration: RegistrationConfirmed, Standard access model.
- [Collection transaction](https://preprod.cardanoscan.io/transaction/216f781ace511d1f4e690ea3633916b03d7289950601a4ff99e4fa6eaf12f34b): 1,000,000 Masumi tUSDM base units to the registered selling wallet.
- [Sweep transaction](https://preprod.cardanoscan.io/transaction/100acc1782a1f9f35525db7ef8db5f10acceb07f541292038ef2cb90692b94ac): that 1 tUSDM transferred into the splitter.
- [Distribution transaction](https://preprod.cardanoscan.io/transaction/a58888e10d7a20ff73dcd33f23902d0994de8fbddfe48df573173a0f088141b5): consumed the sweep output and a pending 0.50 x402 tUSDM payment. Investor output: 100,000 Masumi + 50,000 x402 base units. Atlas output: 900,000 Masumi + 450,000 x402 base units. Each asset splits 10/90 independently.

Blockfrost confirmed all three transactions. Public input/output evidence is saved in `docs/samples/settlement-verification.json`; no credentials are included. The local dashboard displayed the distribution link and zero funds awaiting the next split at verification time. Masumi funds remain operator-controlled until the sweep confirms.

## Reliability changes

- Demo outcomes use the process result and required evidence; failures, REVIEW, unchanged ratings and empty distributions are accurately described. Lost connections stop the spinner and warn against blind retries.
- Dashboard Cardano reads paginate the full history and current UTxOs, separate both assets, and calculate net wallet receipts so change is not mistaken for new earnings.
- Paid RUNNING Tasks without persisted local state stop for inspection rather than creating a second payment. Interrupted payment-write stages and expired unfunded terms have regression coverage.
- Sweep checks the seed-derived source address against the registered payout address before signing.
- Atlas creates a real sample report on demand after restart; probe challenges reject odd-length hex.
- Overview, methodology, operations and presentation scripts reflect the Standard registration, pre-applied x402 script, freshness refresh and selling-wallet trust gap.

## Checks

- Workspace tests: **62 passed** (cardano-tx 7, shared 14, Atlas 8, buyer 5, Coworker 19, dashboard 9).
- Workspace TypeScript checks: passed.
- Aiken: **27 tests passed**, including two property tests with 100 checks each; zero errors/warnings.
- Foundry: **11 tests passed**.
- Payment gate: **12 Bun tests passed**, workflow type check passed.
- Rating workflow: **5 Bun tests passed**, workflow type check passed.
- Clean source snapshot without secrets: `npm ci`, workspace tests/type checks and dashboard production build passed. Dependency versions remain pinned.
- Scan of 217 tracked/intended new application files found no exact matches for configured local secrets; credential environment files and the outer `codex.md` remain Git-ignored. This is an exact-match check, not a full security audit.
- Local Atlas, Coworker, MPS and dashboard HTTP checks passed. These verify local availability, not public hosting.

Cardano work used the installed `debug-transaction` skill and its bundled `cardano-dev-skills/docs/sources` corpus; Masumi flow used the project `.claude/skills/masumi/SKILL.md` and `references/api-debug-recipes.md`; CRE verification used `chainlink-cre-skill` and its simulation/operations references.

## Remaining final stage

- Public persistent hosting and external reachability, persisted task state, unattended sweep/distribution and rating refresh, and public Standard registration URL.
- Final deck with embedded three-minute video, shared artifact links and track submission checks. Vercel dashboard should be read-only; live action buttons require the repository and CRE CLI on a persistent host.
- Public social metadata URL (`metadataBase`) should be configured once hosting is chosen; the clean build currently defaults it to localhost.
- CRE DON deployment remains pending. Existing evidence proves local simulation plus real testnet transactions, not independent DON consensus or enclave confidentiality.
- Optional receipt tokens, repayment cap and new gate identity policy remain future features, not completed changes.

Keep secrets in ignored environment files. The local session record is the outer repository's `codex.md`, excluded from Git.

## Cardano upgrade verification — 6 October

Subsequent report-quality and Task repayment work brings the workspace total to **90 passing tests** (cardano-tx 7, shared 34, Atlas 8, buyer 5, Coworker 19, dashboard 17). Workspace type checks and the clean dashboard production build passed again. Contract/workflow results above are from the earlier verification phase; those components were not changed by these two upgrades.

The repayment timeline verifies the saved Task's direct collection/sweep/payout references against read-only chain data. Desktop and mobile screenshots are `docs/evidence/task-repayment-desktop.png` and `docs/evidence/task-repayment-mobile.png`. See `docs/TASK_REPAYMENT.md` for the verification rules, eight regression cases and attribution limits. No new payment or deployment was needed.

## 6 October 2026 — Cardano hardening

- 111 regression tests passed: 105 in the final workspace run, followed by six additional capital verification guards. Full workspace type checks and final isolated production build passed. No on-chain validator changes.
- Confirmed authorized 2-test-ADA funding from investor, immutable existing 10% terms fingerprint and subsequent 0.05/0.45 x402 tUSDM split. Public evidence: `evidence/funding/`.
- Automatic keeper is active locally with persistent journal/confirmation sequencing. UI refuses manual distribution while its daemon lock is present. Unknown submissions block; hosting supervision remains pending.
- Browser verified funding details and the provenance warning for a listed mainnet address; mobile width 390 equals document width. Screenshots: `evidence/cardano-hardening/funding-desktop.png`, `threat-source-desktop.png`, `threat-source-mobile.png`.
- Final source disclaimer distinguishes registry claims from trust certification. Live counts remain 1 verified collection and 3 unfunded historical paid-request failures. Three user-created new Tasks remain pending. Simulated 100-lifecycle test is labelled simulated.
- Exact-match scan of 258 tracked/intended files found no configured root/worker secret values; this is not a full security audit. Whitespace check passed. No commits/pushes.
- Review page: http://127.0.0.1:3100/. Primary web port 3000 still serves its previous build.
