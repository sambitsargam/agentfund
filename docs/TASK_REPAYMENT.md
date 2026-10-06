# Paid Task repayment timeline

The dashboard's Sokosumi section connects the paid Task to four steps: report delivery, collection into the registered wallet, direct sweep into the contract, and investor/Atlas payout. Each blockchain step links to its preprod transaction. Task, payment-event and completion-event identifiers appear under “How this path is verified”.

## Evidence rule

1. The collection transaction must show positive net Masumi tUSDM receipts at the configured payout address, matching the worker's recorded collected amount when available.
2. A sweep must consume that collection output by transaction hash **and output index** and send at least that output's Masumi tokens to the configured splitter.
3. A paying batch must consume the exact sweep output at the splitter. Net receipts at the configured investor and Atlas addresses must satisfy the deal's 10/90 rule for all Masumi tokens consumed from the contract.
4. Reference/collateral inputs are excluded. x402 tUSDM cannot stand in for Masumi tUSDM, and existing investor wallet funds returned as change do not count as repayment.

Amounts are batch totals. Fungible tokens in a combined sweep cannot be uniquely allocated back to individual Tasks. Multiple Tasks may show the same batch transaction and batch payout; those figures must not be added as independent Task repayments.

## States and limits

- **Investor payout verified:** every relevant receipt output has a direct path to a verified paying batch.
- **Reached the contract · payout not verified:** the sweep path exists; a valid investor payout is not yet established. This does not assert that the contract coin is still unspent.
- **Collected · sweep not verified:** receipt is confirmed, but a complete direct sweep is missing. Funds could remain in the wallet or have moved through an intermediate transaction.
- **Repayment needs verification:** receipt mismatch or chain/provider evidence unavailable. A worker receipt alone cannot prove investor repayment.

This is a read-only evidence view. It does not sign transactions, trigger sweeps or distribute funds. It explicitly shows the operator-controlled wallet window before the contract enforces repayment.

## Regression coverage

Eight scenarios cover the saved real mixed-asset collection/sweep/distribution; unrelated equal-amount transactions; wrong output indices; reference/collateral inputs; sweep without payout; wrong-asset payouts and investor change; mismatched/partial receipts; and multiple collections sharing a batch.

The real path is collection `216f781ace511d1f4e690ea3633916b03d7289950601a4ff99e4fa6eaf12f34b` → sweep `100acc1782a1f9f35525db7ef8db5f10acceb07f541292038ef2cb90692b94ac` → distribution `a58888e10d7a20ff73dcd33f23902d0994de8fbddfe48df573173a0f088141b5`. Its Masumi batch pays investor 0.10 and Atlas 0.90 tUSDM; the separate x402 payout is not included in those figures.

References used: project `masumi` skill `references/api-debug-recipes.md`, and bundled Cardano `docs/sources/blockfrost-openapi/src/schemas/txs/tx_content_utxo.yaml` for transaction-output indices and reference/collateral semantics.
