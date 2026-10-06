# How Atlas produces a report

Atlas answers one question: **what does this Cardano address’s public history tell us before payment?** It does that from public chain data only. It never asks for a signature, a key, or any private information.

## Input

One of:

- a preprod payment address (`addr_test1…`),
- a stake address (`stake_test1…`), resolved to the first payment address it controls,
- an ADA Handle (`$name`), resolved through the handle policy `f0ff48bb…fb9a`, trying the CIP-68 user-token name first and the bare name second.

Free text is accepted; the first address-like token in it is used, so a Sokosumi Task can say "is it safe to pay addr_test1…?". A mainnet address is rejected explicitly rather than guessed at, and anything unreadable gets a short explanation of what to send instead.

## What is measured

| Fact | Source |
| --- | --- |
| Balance, assets held, address type (wallet or script), stake address | Blockfrost `/addresses/{address}` |
| Lifetime transaction count | Blockfrost `/addresses/{address}/total` |
| First activity | Blockfrost `/addresses/{address}/transactions?order=asc&count=1` |
| Last activity, recent activity in 24 h and 30 d | Blockfrost `/addresses/{address}/transactions?order=desc&count=100` |
| Stake delegation | Blockfrost `/accounts/{stake}` |
| Counterparties | Blockfrost `/txs/{hash}/utxos` for the 8 most recent transactions; the other addresses appearing as inputs or outputs, counted by how many of those transactions they appear in |

Atlas also checks for a Masumi registry NFT under the configured preprod policy and reads its public metadata (name, service, author and capability). This is a registration claim, not proof of safety. It inspects the lifetime history of the three most frequent counterparties in the eight-transaction sample. Registration never removes risk points or contract/no-staking-key warnings; it records identity claims separately.

Every endpoint used is listed in the report's own "Sources" section, along with the transaction hashes it relied on.

## The risk score

Missing core history produces Unknown. The report includes a recommended next step, exact sampling scope, and missing or conflicting balance checks. These limitations are shown in both Markdown and the dashboard.

The score is a deterministic function of the measured facts and a timestamp — the same facts always give the same number, which is what lets the Chainlink workflow probe Atlas and lets anyone reproduce a verdict.

| Finding | Points |
| --- | --- |
| Never used on preprod | 60, and the verdict is "unknown" |
| First used less than a day ago | 35 |
| First used less than 7 days ago | 25 |
| First used less than 30 days ago | 10 |
| Fewer than 3 transactions | 15 |
| 10 or more transactions in 24 h on an address under 7 days old | 10 |
| No activity for more than 180 days | 10 |
| Smart contract | 15 |
| No staking key on a normal wallet | 5 |
| At least two sampled counterparties each have 1–2 lifetime transactions | 10 |
| Currently empty | 5 |
| The two data sources disagree on the balance | 10 |

Points are summed and capped at 100. **0–20 low, 21–45 medium, above 45 high.** Good signs — long history, high transaction count, recent activity, stake delegation, several kinds of token — are reported but never subtract from risk, because an attacker can manufacture them cheaply.

The weights encode one judgement: *age and history are hard to fake, balance is not*. A wallet that has been used steadily for a year is unlikely to be a typo or a freshly minted scam address. A wallet created an hour ago with a large balance is exactly what both look like.

## Accuracy check

See `docs/RESULT_QUALITY.md` for the reproducible sixteen-case policy evaluation and three known-role live snapshots. These check implementation consistency and observed facts, not fraud prediction accuracy.

Risk scoring has no ground truth, so Atlas does not claim accuracy it cannot show. What it does instead is make its inputs checkable in two ways.

**Independent cross-check.** The ADA balance is fetched a second time from [Koios](https://koios.rest), an independent indexer with its own node infrastructure, and the two are compared. Agreement is reported in the result; disagreement adds 10 risk points and says so in plain words, because it means one of the sources is lagging and the rest of the figures should be treated with care. The three live quality-evaluation snapshots agreed; missing or disagreeing responses remain explicit report states.

**Reproducibility.** Every report lists the endpoints queried and the transaction hashes used, so a reader can re-run the same queries and get the same facts. The score is a pure function of those facts, and the scoring table is printed inside every report.

Worked example, against the Masumi escrow contract `addr_test1wzs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgn37w4g`:

> **Low risk (15/100)** · Low risk: an established address with normal activity.
>
> - First used 2026-07-03 (94 days ago), last active today
> - 2,496 transactions in total, 100 in the last 30 days
> - Balance 24,387.8 ADA and 415.2 tUSDM
> - Smart contract, no staking key → +15
> - Balance confirmed by Blockfrost and Koios, both reporting 24,387,808,910 lovelace

The 15 points come from it being a contract, which is correct and useful: you *should* understand a contract before paying it. The verdict stays low because it is long-lived and heavily used.

## Known limits

- **Preprod only.** Mainnet heuristics would need recalibration; a 30-day-old mainnet wallet is far more suspicious than a 30-day-old test wallet.
- **Counterparties are sampled** from the 8 most recent transactions, not the full history, with up to three counterparties examined one hop further. Request count and latency vary with identity detection and address/handle resolution; older 11–14-call figures predate those checks.
- **Limited identity data.** Masumi registry metadata identifies a registered agent's claims; Atlas has no exchange/scammer-labelled address feed and cannot verify the operator's real-world identity. A labelled-address feed is the obvious next source.
- **A quiet address is not a safe one.** Low risk means "nothing here looks wrong", not "this is the right recipient". The report says so.
