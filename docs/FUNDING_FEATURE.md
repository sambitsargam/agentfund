# Funding rounds: product flow

Atlas can offer a preprod funding round from the **Fund an agent** tab. Its configured
operator connects a CIP-30 wallet, sets test tUSDM capital, investor share and repayment cap,
and approves an offer transaction. Opening retains 5 test ADA in the authenticated state
coin; the current validator does not reclaim this deposit after closure.

An investor connects their own preprod wallet, reviews the offer, and approves funding.
Capital reaches Atlas in the same transaction that activates the investor share. The
server builds unsigned transactions and merges wallet witnesses; it has no signing keys
in this flow. All chain writes require the connected wallet's signature and submission.
The wallet must hold the correct preprod tUSDM asset, test ADA and collateral.

Each funded round has its own `/rounds/<round-id>/report` x402 endpoint. Its 402 challenge
binds payment to that exact parameterised validator. An unfunded, cancelled, missing or
unreadable round does not request payment. The existing `/report` endpoint continues its
fixed splitter deal. Masumi earnings still require an operator sweep and do not enter these
rounds. The round endpoint is direct x402; it is **not covered by the existing Chainlink
demo gate**, whose fixed contract binding remains unchanged.

Anyone with a preprod wallet can release confirmed round earnings. The contract calculates
the cumulative investor share, caps it, and closes the round at the cap. Future deposits
then go entirely to the operator. A release handles up to four payment UTxOs per transaction;
refresh and release another batch when more remain. The share is non-transferable. Funding
is neither guaranteed repayment nor evidence of future demand.

## Run locally

- Start Atlas normally (`npm start -w @agentfund/atlas`) and the web app. Configure the root
  `.env` and web server with the preprod Blockfrost key; never expose it as a browser variable.
- `AGENTFUND_ROOT` can explicitly identify the application repository. Otherwise the server
  locates its blueprint by walking parent directories. For a packaged deployment, include
  `contracts/cardano/plutus.json` and set `AGENTFUND_ROOT`.
- `FUNDING_DATA_DIR` optionally relocates the shared durable round/ticket/purchase store.
  Locally, both Atlas and the dashboard must use the same store. Hosted services use the authenticated funding API described below. Default: `services/keeper/data/funding`.
- `ATLAS_PUBLIC_URL` controls the round endpoint displayed in the dashboard; `ATLAS_URL`
  controls the buyer CLI. Use the actual Atlas service origin, not the dashboard origin.
- Open the dashboard in a browser with a Cardano wallet extension; the Codex preview does
  not provide one. Choose preprod in the wallet (CIP-30 network ID 0 alone also includes preview).

To exercise a customer payment after funding:

```sh
npm run round-buy -w @agentfund/buyer-agent -- <round-id> <Cardano-address> <unique-order-id>
```

The buyer limits each purchase to 0.50 tUSDM and checks the exact round address, script,
asset and amount. Reusing an order ID reuses its saved signed payment, or reports an already
delivered order. Use a new order ID only for an intentional new purchase. The existing
`buy` command remains the separate Chainlink-gated fixed-splitter demonstration.

## Confirmation and recovery

Wallet funding stores the signed transaction before submission. If submission times out,
**Check confirmation** queries the exact saved hash. **Resubmit saved transaction** sends
the same bytes, never rebuilds a payment. Reloading the page restores that proposal from
browser storage. An unsigned proposal may be discarded; a signed proposal is retained
until its hash is confirmed. An expired signed transaction with no confirmation needs
manual chain inspection; the UI deliberately does not infer safe replacement from absence.

The legacy `round` CLI now saves the transaction hash before signing/submission and keeps
its pending state until confirmation. `round resolve` checks that exact hash. It no longer
adopts arbitrary recent transactions or clears pending state because an address listing is
empty. Legacy pending records without hashes require manual inspection.

## Evidence scope

See `docs/samples/round-f603a10c-verification.json` for the product-path preprod test. The earlier `round.json` demonstration used operator deposits; its UI is now labelled
accordingly. Unit tests cover wallet account changes, mainnet refusal, expiry, timeout/restart
retries, funding-state payment refusal and exact x402 destination binding. These tests do not
substitute for third-party usability studies, customer demand, or a production security audit.

## Hosted funding (7 October completion)

The Vercel dashboard forwards `/api/funding` to the Coworker host's persistent `/funding` API.
Set `FUNDING_API_URL=https://<coworker-host>/funding` on Vercel and Atlas;
set `FUNDING_API_TOKEN` on Vercel;
set the same token on Atlas and Coworker. The token remains server-only. The Coworker host owns the round and
proposal store on its attached volume (`FUNDING_DATA_DIR=/data/funding`). The paid round
routes read that same store through the authenticated catalog API, so a new funded offer is immediately available to customers.
Do not put this store on Vercel's ephemeral filesystem or on independent service disks.

If the backend is missing or unreachable, the dashboard returns a clear 503 and preserves
saved signed transactions. It never silently falls back to a temporary serverless store.
The published round catalog in `docs/samples/funding-rounds.json` restores the verified
closed demonstration on a fresh host; it contains public terms and seed references only.
New offers and unsigned proposals persist in the volume. Back up that volume.

The customer-funded test is recorded in `docs/samples/round-f603a10c-verification.json`:
0.20 tUSDM capital, two 0.50 tUSDM x402 purchases from our test buyer, and investor payouts
of 0.25 then 0.05 tUSDM, closing at the 0.30 cap. This is internal testnet evidence, not an
external paying-customer study. No new payment is needed to reverify it.

## Funding request protections

The persistent backend limits all callers together to six transaction preparations, 30 confirmation checks, 120 reads and 120 other actions per minute. Limits survive process restarts and return HTTP 429 with a retry delay; public round reads share a ten-second cache and an in-flight read. This bounds provider usage; it is not per-user authentication or general DDoS protection.

A filesystem lock serializes builders across processes sharing the funding volume. Each stored proposal reserves its wallet and round until its chain validity has expired (the nine-minute signing deadline plus a two-minute margin), or until its exact transaction hash is confirmed. Closing a browser or discarding an unsigned proposal does not prematurely release that reservation. External wallet transactions can still spend those inputs. After an unexpected host crash, a remaining `.proposal-lock` or `.quota-lock` requires operator inspection before removal; do not clear one while a builder is active.

Before assembly, every supplied Ed25519 witness must verify over the proposal's transaction hash, and at least one must match the expected payment key. Wrong-wallet, malformed and wrong-transaction signatures are rejected before submission. The server still has no signing keys.
