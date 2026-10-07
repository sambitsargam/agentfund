# Chainlink CRE evidence

All runs use `cre workflow simulate` (CRE CLI v1.36.0) against real services: Blockfrost (Cardano preprod), Atlas's `/probe`, and Base Sepolia through the simulation forwarder `0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5`. Raw outputs are in `docs/evidence/`.

## Registry

`AgentRatingRegistry` on Base Sepolia: [`0xee171354e30f24428eEaAaDA952eEC7479b08131`](https://sepolia.basescan.org/address/0xee171354e30f24428eEaAaDA952eEC7479b08131), deployed in [`0x27bf50e2…0e02`](https://sepolia.basescan.org/tx/0x27bf50e25bb91b0fff094f6a0ef961e6b19bc9613a47f8ab39b4102a32f70e02).

## Rating workflow (`workflows/rating`, `@chainlink/cre-sdk` 1.23.0)

| Run     | Trigger                               | Agreed observation                                                | Score                     | Result                                                                                                                                                                                                                            |
| ------- | ------------------------------------- | ----------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dry run | cron (index 0)                        | —                                                                 | —                         | Reached `writeReport`; fails closed with no tx hash, as expected without `--broadcast` (`rating-dryrun.log`)                                                                                                                      |
| 1       | cron (index 0), `--broadcast`         | earnings 1,000,000 (1 tUSDM), 3 transactions, probe passed, 12 ms | 385 = 40 + 45 + 200 + 100 | Written: [`0xf138767596853c880c51935ef355c7a874d4f9e78ebe534fad8217725f87ce9d`](https://sepolia.basescan.org/tx/0xf138767596853c880c51935ef355c7a874d4f9e78ebe534fad8217725f87ce9d), block 47745390 (`rating-cron-broadcast.log`) |
| 2       | HTTP refresh (index 1), `--broadcast` | same                                                              | 385                       | Unchanged, write skipped (`rating-http-refresh.log`)                                                                                                                                                                              |

Read back with `cast call … getRating(bytes32)` for agent id `keccak256("atlas")` = `0xb7d6c242…8d7b`: `(385, 1000000, 3, true, 12, 1791259064)`.

HTTP calls per run: 2 of 15 (Blockfrost totals, Atlas probe).

## Payment gate (`workflows/payment-gate`, `@chainlink/cre-sdk` 1.18.0, Confidential Workflow)

Started from Chainlink's `ai-audit-firewall-ts` template (cre-templates `d0223f3`): `handlerInTee`, a closed capability `preHook`, secrets read inside the enclave, and `usingTheDons()` for the chain read and the report/write. Rebuilt around our proposal, policy, auditors and registry.

- Trigger: HTTP, carrying the buyer agent's payment proposal (built from Atlas's real 402 offer). `handlerInTee` accepts the HTTP trigger in this SDK version and the simulator runs it.
- Restrictions (closed): 4 HTTP sends, 1 EVM read, 1 EVM write, 1 consensus report; secrets limited to `blockfrost_project_id`, `auditor_a_key`, `auditor_b_key`.

| Run     | Proposal                                                        | Auditors                 | Decision on-chain                       | Tx                                                                                                                                                                         |
| ------- | --------------------------------------------------------------- | ------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dry run | genuine (payTo = splitter)                                      | mock: allow/92, allow/92 | reached `writeReport`, no tx (expected) | `gate-allow-dryrun.log`                                                                                                                                                    |
| 1       | genuine, request `0x3b590403…2783`                              | mock: allow/92, allow/92 | **ALLOW**, flags 0, rating 385          | [`0xa0c7ae232d5ba76af45a905a001bd0e9974ad7390805795c172af2f8a41f5a06`](https://sepolia.basescan.org/tx/0xa0c7ae232d5ba76af45a905a001bd0e9974ad7390805795c172af2f8a41f5a06) |
| 2       | tampered payTo (Investor A's wallet), request `0xe6f4d50c…ea0f` | not called               | **DENY**, flags 1 (`payToMismatch`)     | [`0x9dd378a1df8edab766f15262f6a4fabf1d1676342c2c4c0cb4c70be10247cf60`](https://sepolia.basescan.org/tx/0x9dd378a1df8edab766f15262f6a4fabf1d1676342c2c4c0cb4c70be10247cf60) |

Read back with `getDecision(bytes32)`: run 1 `(atlas, 1, 0, 385, 1791259461)`, run 2 `(atlas, 2, 1, 385, 1791259469)`.

| 3 | buyer agent, genuine, request `0xd5cefbdb…e495` | mock: allow, allow | **ALLOW**, rating 385; buyer then paid on Cardano [`3efa54df…59ba`](https://preprod.cardanoscan.io/transaction/3efa54df70e619e349db20ce5e925ebdb6c771e76131bfd485071dac871d59ba) with the request id in its datum | [`0x95bd73aa0c306b64294145e27908c9758f77deb166d38313021ea1ce2ff43a5a`](https://sepolia.basescan.org/tx/0x95bd73aa0c306b64294145e27908c9758f77deb166d38313021ea1ce2ff43a5a) |
| 4 | buyer agent `--tamper`, request `0xfc01bda4…7302` | not called | **DENY**, flags 1; buyer did not pay | [`0xc625f8ae1158732948d79b209f64331efa8b087dba5fa86985725883f07aba39`](https://sepolia.basescan.org/tx/0xc625f8ae1158732948d79b209f64331efa8b087dba5fa86985725883f07aba39) |

### With real LLM auditors (OpenAI: offer integrity on `gpt-4.1-mini`, report quality on `gpt-4o-mini`)

| Run | Proposal                              | Decision                                                                                                                                                                                              | Tx                                                                                                                                                                         |
| --- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | genuine, request `0x1fc2fcd0…`        | **REVIEW**, flags 256 (`auditorUnsure`): the report-quality auditor graded the checked wallet instead of the seller's work; buyer did not pay. Prompt clarified afterwards.                           | [`0x9ecccecc14d7eccc1d0381c72945ea43defe0d6ec21a3efd817c902933a07104`](https://sepolia.basescan.org/tx/0x9ecccecc14d7eccc1d0381c72945ea43defe0d6ec21a3efd817c902933a07104) |
| 6   | genuine, request `0x8a0870b5…`        | **ALLOW**, flags 0 (auditors allow/95, allow/85); buyer paid [`f06f7e3e…ff1f`](https://preprod.cardanoscan.io/transaction/f06f7e3e69ca2824cdb071022f4e443b51487d85f9a81a94d412e19f9699ff1f) in 28.1 s | [`0x40c7db9914c310aa23a83b6594ed72e1073db65742de6dc79096a0ce2a793373`](https://sepolia.basescan.org/tx/0x40c7db9914c310aa23a83b6594ed72e1073db65742de6dc79096a0ce2a793373) |
| 7   | tampered payTo, request `0x2f1578fe…` | **DENY**, flags 1; auditors not called; buyer did not pay                                                                                                                                             | [`0x6ac84adaafbc31f5cdec5073904970236574c41be8eef539dd28ce9c19868925`](https://sepolia.basescan.org/tx/0x6ac84adaafbc31f5cdec5073904970236574c41be8eef539dd28ce9c19868925) |

### After hosting Atlas

Moving Atlas to a public host left this workflow probing `localhost`, so every run failed and
the rating went stale — the freshness rule working as designed, on a cause outside the workflow.
Re-pointed at the hosted URL, the cron run reads the agent over the public internet:

| Run | Agreed observation                                                               | Score                        | Result                                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | earnings 10,000,000 (10 tUSDM), 22 transactions, probe passed over HTTPS, 363 ms | 1000 = 400 + 300 + 200 + 100 | Written: [`0x6899b22e5276f91e833458c5c4730c61ad9350120c3206b00ea6efc6bbb9bb56`](https://sepolia.basescan.org/tx/0x6899b22e5276f91e833458c5c4730c61ad9350120c3206b00ea6efc6bbb9bb56) |
