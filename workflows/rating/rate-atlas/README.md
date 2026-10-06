# Rating workflow

Rates Atlas and records the score in `AgentRatingRegistry` on Base Sepolia.

Handlers: a cron trigger (every 15 minutes) and an HTTP trigger for an on-demand refresh. Both run the same callback:

1. Read the Blockfrost project id from the CRE secret `BLOCKFROST_PROJECT_ID` (DON mode).
2. In node mode, each node reads the splitter's lifetime totals from Blockfrost (earnings = both tUSDM units in `received_sum`, plus `tx_count`) and calls Atlas's `/probe` with a challenge derived from DON time, timing the call.
3. Nodes agree with `ConsensusAggregationByFields`: median for earnings, transaction count and latency, identical for the probe result.
4. EVM read of the stored rating; the write is skipped when nothing changed and the previous observation is less than 30 minutes old. Otherwise the timestamp is refreshed to satisfy the gate's one-hour freshness rule.
5. Otherwise a kind-1 report is signed with `runtime.report` and delivered with `EVMClient.writeReport`.

Score (out of 1000): earnings up to 400 (full at 10 tUSDM), activity up to 300 (full at 20 transactions), passing probe 200, latency 100 under 2 s or 50 under 5 s.

HTTP calls per run: 2 of 15.

```bash
cre workflow simulate rate-atlas --target staging-settings --non-interactive --trigger-index 0
cre workflow simulate rate-atlas --target staging-settings --non-interactive --trigger-index 0 --broadcast
cre workflow simulate rate-atlas --target staging-settings --non-interactive --trigger-index 1 --http-payload '{}' --broadcast
```
