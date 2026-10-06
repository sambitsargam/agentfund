# Chainlink CRE evidence

All runs use `cre workflow simulate` (CRE CLI v1.36.0) against real services: Blockfrost (Cardano preprod), Atlas's `/probe`, and Base Sepolia through the simulation forwarder `0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5`. Raw outputs are in `docs/evidence/`.

## Registry

`AgentRatingRegistry` on Base Sepolia: [`0xee171354e30f24428eEaAaDA952eEC7479b08131`](https://sepolia.basescan.org/address/0xee171354e30f24428eEaAaDA952eEC7479b08131), deployed in [`0x27bf50e2…0e02`](https://sepolia.basescan.org/tx/0x27bf50e25bb91b0fff094f6a0ef961e6b19bc9613a47f8ab39b4102a32f70e02).

## Rating workflow (`workflows/rating`, `@chainlink/cre-sdk` 1.23.0)

| Run | Trigger | Agreed observation | Score | Result |
| --- | --- | --- | --- | --- |
| Dry run | cron (index 0) | — | — | Reached `writeReport`; fails closed with no tx hash, as expected without `--broadcast` (`rating-dryrun.log`) |
| 1 | cron (index 0), `--broadcast` | earnings 1,000,000 (1 tUSDM), 3 transactions, probe passed, 12 ms | 385 = 40 + 45 + 200 + 100 | Written: [`0xf138767596853c880c51935ef355c7a874d4f9e78ebe534fad8217725f87ce9d`](https://sepolia.basescan.org/tx/0xf138767596853c880c51935ef355c7a874d4f9e78ebe534fad8217725f87ce9d), block 47745390 (`rating-cron-broadcast.log`) |
| 2 | HTTP refresh (index 1), `--broadcast` | same | 385 | Unchanged, write skipped (`rating-http-refresh.log`) |

Read back with `cast call … getRating(bytes32)` for agent id `keccak256("atlas")` = `0xb7d6c242…8d7b`: `(385, 1000000, 3, true, 12, 1791259064)`.

HTTP calls per run: 2 of 15 (Blockfrost totals, Atlas probe).

## Payment gate (`workflows/payment-gate`, `@chainlink/cre-sdk` 1.18.0, Confidential Workflow)

Started from Chainlink's `ai-audit-firewall-ts` template (cre-templates `d0223f3`): `handlerInTee`, a closed capability `preHook`, secrets read inside the enclave, and `usingTheDons()` for the chain read and the report/write. Rebuilt around our proposal, policy, auditors and registry.

- Trigger: HTTP, carrying the buyer agent's payment proposal (built from Atlas's real 402 offer). `handlerInTee` accepts the HTTP trigger in this SDK version and the simulator runs it.
- Restrictions (closed): 4 HTTP sends, 1 EVM read, 1 EVM write, 1 consensus report; secrets limited to `blockfrost_project_id`, `auditor_a_key`, `auditor_b_key`.

| Run | Proposal | Auditors | Decision on-chain | Tx |
| --- | --- | --- | --- | --- |
| Dry run | genuine (payTo = splitter) | mock: allow/92, allow/92 | reached `writeReport`, no tx (expected) | `gate-allow-dryrun.log` |
| 1 | genuine, request `0x3b590403…2783` | mock: allow/92, allow/92 | **ALLOW**, flags 0, rating 385 | [`0xa0c7ae232d5ba76af45a905a001bd0e9974ad7390805795c172af2f8a41f5a06`](https://sepolia.basescan.org/tx/0xa0c7ae232d5ba76af45a905a001bd0e9974ad7390805795c172af2f8a41f5a06) |
| 2 | tampered payTo (Investor A's wallet), request `0xe6f4d50c…ea0f` | not called | **DENY**, flags 1 (`payToMismatch`) | [`0x9dd378a1df8edab766f15262f6a4fabf1d1676342c2c4c0cb4c70be10247cf60`](https://sepolia.basescan.org/tx/0x9dd378a1df8edab766f15262f6a4fabf1d1676342c2c4c0cb4c70be10247cf60) |

Read back with `getDecision(bytes32)`: run 1 `(atlas, 1, 0, 385, 1791259461)`, run 2 `(atlas, 2, 1, 385, 1791259469)`.

**Open:** these runs used the local mock auditors. The allow and deny cases will be re-run with real LLM keys once they are available.
