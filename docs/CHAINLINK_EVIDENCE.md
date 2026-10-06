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
