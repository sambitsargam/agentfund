# Running Atlas, and keeping it running

Atlas is meant to stay available after the hackathon. This is what it takes.

## What has to be running

| Process                | Port | Why it must stay up                                                                                                                                                                      | If it stops                                                                    |
| ---------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `services/atlas`       | 4021 | Serves the paid `/report` route, the free `/probe` the rating workflow calls, `/sample` for the auditors, and the x402 manifest; Standard Masumi registration points at the API base URL | Agent payments fail; the rating drops to 0 for the probe and latency           |
| `services/coworker`    | 4030 | Polls Sokosumi for Tasks and drives the Masumi paid flow                                                                                                                                 | Tasks sit unanswered; a paid Task in flight can miss its result deadline       |
| Masumi payment service | 3012 | Signs seller terms, tracks escrow, submits result hashes, collects                                                                                                                       | Paid Tasks cannot start, and a Task waiting on collection stalls               |
| PostgreSQL             | 5432 | MPS state, including the encrypted wallets                                                                                                                                               | MPS cannot start                                                               |
| `services/keeper`      | —    | Splits locked payments                                                                                                                                                                   | Payments pile up in the contract; nothing is lost, they settle on the next run |
| `apps/web`             | 3000 | The dashboard                                                                                                                                                                            | Judges and investors cannot see the state                                      |

The keeper is run manually today; install a sweep-then-distribute schedule during hosting. For ratings, `scripts/rating-loop.sh` runs the rating workflow every 15 minutes, which is what keeps the gate's one-hour freshness rule satisfied.

## Hosting

The shape that fits is Railway for anything long-running plus Vercel for the dashboard.

**Railway** — one service each for Atlas, the Coworker worker, the keeper and MPS, plus managed PostgreSQL.

- Turn **Serverless off** for every service; a sleeping worker misses Tasks and a sleeping MPS misses an escrow transition.
- Set a **restart policy** so a crash recovers on its own.
- Point Atlas and Coworker health checks at `/health`; use each other service's own health endpoint. The keeper is a command, not an HTTP service.
- Inject secrets as environment variables; never bake a `.env` into an image.
- Attach a volume for the Coworker's `COWORKER_DATA_DIR`. Task state lives there, and a container-local file disappears on redeploy, which is exactly when a paid Task would be repeated.

**Funding persistence** — use the existing Coworker volume at `/data` and set `FUNDING_DATA_DIR=/data/funding`. Configure a server-only shared `FUNDING_API_TOKEN` on Coworker, Atlas and Vercel, and set Vercel and Atlas `FUNDING_API_URL` to the Coworker host’s HTTPS `/funding` endpoint. The dashboard proxies funding requests; Coworker owns the durable store. See [FUNDING_FEATURE.md](FUNDING_FEATURE.md).

**Vercel** — the dashboard. It needs `BLOCKFROST_PROJECT_ID`, `COWORKER_URL` and `BASE_SEPOLIA_RPC`. Leave `DEMO_ACTIONS` unset on Vercel. Live actions launch local commands and the CRE CLI and require a persistent host with the repository, dependencies and testnet credentials; the guards in `apps/web/lib/jobs.ts` do not make that runtime available on Vercel.

After deploying Atlas, update the Standard registration's `apiBaseUrl` to its public HTTPS base URL using MPS. The current CLI `url` subcommand sends `x402ResourcesUrl` and is intended for X402 registrations; do not use it to update this Standard registration. Keep the manifest at `/.well-known/x402.json` for x402 discovery.

## First-time setup from scratch

```bash
# 1. PostgreSQL and the Masumi payment service
createdb mps_agentfund
git clone https://github.com/masumi-network/masumi-payment-service.git
cd masumi-payment-service && cp .env.example .env && chmod 600 .env
```

In that `.env`: set `DATABASE_URL`, a fresh `ENCRYPTION_KEY` and `ADMIN_KEY` (32+ characters each), `BLOCKFROST_API_KEY_PREPROD`, `PORT=3012`, `SEED_ONLY_IF_EMPTY=true`, `AUTO_WITHDRAW_PAYMENTS=true`. **Delete the `PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD` and `REGISTRY_POLICY_ID_PREPROD` lines** — the example file ships placeholder overrides and seeding fails with "Smart contract address is changed" if they are left in.

```bash
pnpm install --frozen-lockfile && pnpm run prisma:generate && pnpm run prisma:migrate
pnpm run prisma:seed >/dev/null 2>&1   # suppressed: it prints wallet mnemonics
pnpm -C frontend run build && pnpm run dev
```

Fund the seeded selling wallet with test ADA from https://dispenser.masumi.network, then create a scoped runtime key (read + pay, no admin, Preprod only) in the admin dashboard and put it in `services/coworker/.env.local` as `MPS_RUNTIME_TOKEN`.

```bash
# 2. Sokosumi
npm i -g @masumi_network/sokosumi
sokosumi --preprod auth login
sokosumi --preprod vendors create --name "AgentFund" --slug agentfund
sokosumi --preprod coworkers register --personal --vendor-id <id> --name Atlas --capability tasks
# then save the runtime key into services/coworker/.env.local (see Masumi's agent guide)

# 3. Masumi registration
npm run register -w @agentfund/coworker
npm run register -w @agentfund/coworker -- check   # until RegistrationConfirmed
```

## Sweeping collected Masumi earnings

Export the registered **selling** wallet from MPS Admin → Wallets. Put its seed phrase in the ignored application `.env` as `MPS_SELLING_WALLET_MNEMONIC`; do not paste it into chat or documentation. The sweep refuses to sign if this seed derives a different address from the registered payout address. Keep `services/coworker/data/registration.json` or point `COWORKER_DATA_DIR` at persisted state.

```bash
npm run sweep -w @agentfund/keeper
# Wait for the printed transaction to appear on preprod before distributing.
npm run distribute -w @agentfund/keeper
```

A transaction hash means submission; verify its outputs on-chain before declaring completion or retrying an ambiguous submission.

## Task repayment timeline

The dashboard reads each collected Task's transaction and follows exact output references through the direct sweep and splitter spend. It verifies both investor and Atlas receipts in Masumi tUSDM and excludes wallet change. Timeline figures are batch totals, not per-Task allocations.

The worker publishes its public `collectionAddress` alongside the receipt. Older workers fall back to the current preprod collection-wallet configuration in `packages/shared/src/deal.ts`; set `MASUMI_PAYOUT_ADDRESS` on the dashboard when migrating registration, until the worker feed supplies the new address. Set `COWORKER_URL` to the worker's reachable base URL. Never substitute a mnemonic for this public address.

The timeline deliberately leaves an indirect wallet transfer, partial sweep, unavailable indexer response or unmatched receipt unverified. Such cases require inspection; matching amounts or timestamps are not sufficient proof.

## Costs

Everything below is testnet today; these are the mainnet equivalents.

| Item                                           | Rough cost                                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosting (Railway: 4 small services + Postgres) | $20–40 / month                                                                                                                                                |
| Dashboard (Vercel hobby)                       | $0                                                                                                                                                            |
| Blockfrost                                     | Free tier covers ~50k requests/day; report request counts vary with subject resolution, agent identity and counterparty checks; each report lists its sources |
| OpenAI auditors                                | About $0.002 per gated payment at current `gpt-4.1-mini` / `gpt-4o-mini` prices                                                                               |
| Cardano fees                                   | ~0.17 ADA per payment (paid by the buyer), ~0.27 ADA per distribution batch (paid by Atlas)                                                                   |
| Masumi protocol fee                            | 5% of escrow payments                                                                                                                                         |

At 0.50 tUSDM per report, Atlas covers its hosting at roughly 100 reports a month.

## Key rotation

| Secret                | Where it lives                 | Rotating it                                                                                         |
| --------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------- |
| Blockfrost project id | `.env`, host env               | Create a new project, swap the value, restart                                                       |
| Coworker runtime key  | `services/coworker/.env.local` | `sokosumi --preprod coworkers api-key <id>`, then re-import to the vault                            |
| MPS runtime token     | `services/coworker/.env.local` | Create a new scoped key in the MPS dashboard, delete the old one                                    |
| MPS `ENCRYPTION_KEY`  | MPS `.env`                     | **Do not rotate casually**: it decrypts the stored wallets. Back it up separately from the database |
| OpenAI key            | `workflows/payment-gate/.env`  | Swap and re-run the gate                                                                            |
| Cardano mnemonics     | `.env`, never committed        | Move funds to a new wallet, update the deal, redeploy the splitter (the address changes)            |

Back up the MPS database and keep the encryption key somewhere else. Restoring one without the other loses the wallets.

## Moving to mainnet later

1. Audit the splitter. It is small and tested, but it holds other people's money.
2. Re-derive the splitter with mainnet addresses; the address changes, so re-point Atlas and the gate.
3. Deploy a second `AgentRatingRegistry` trusting the **production** Chainlink forwarder, not the simulation one.
4. Deploy the CRE workflows to a DON rather than running them with the CLI.
5. Recalibrate the risk weights: a 30-day-old mainnet wallet is far more suspicious than a 30-day-old test wallet.
6. Switch Masumi and Sokosumi to mainnet and re-register; the agent identifier is per network.

## Monitoring

`/health` on Atlas and the Coworker is enough for a host check — the Coworker's returns 503 if it has not polled in 60 seconds, so a stuck poll loop is visible rather than silent. Beyond that, the two things worth alerting on are the splitter holding funds for more than an hour (the keeper has stopped) and the rating's `observedAt` falling more than an hour behind (the rating loop has stopped, and the gate will start returning Review).

## Automatic keeper and funding evidence

Use `npm run loop -w @agentfund/keeper` for automatic sweep/confirmation/distribution/confirmation. Its ignored journal is `services/keeper/data/status.json`; `loop.lock` prevents duplicate daemons. Never run manual keeper commands concurrently. Inspect ambiguous submissions, blocked states and stale locks against the chain before recovery; do not delete state to force a retry. This process needs hosting supervision and alerts before a public reliability claim. Operator custody remains.

The existing closed 2-test-ADA seed round can be inspected with `npm run funding -w @agentfund/keeper -- review` and independently reverified with `-- verify`. `-- fund` refuses a second attempt for an already attempted round. Do not edit the record to bypass that protection. Public terms/capital/payout records are in `docs/evidence/funding/`. Worker `/reliability` includes historical failures; keep its durable Task directory across deployments. See [CARDANO_HARDENING.md](CARDANO_HARDENING.md) for evidence and outstanding limits.

## Run exactly one worker

One Coworker identity must be polled by one worker process. Two workers both see a Task as
`READY`, both post `RUNNING`, and both sign payment terms; the marketplace accepts one, and the
loser records a failure for work that was never lost. That is how a hosted worker and a laptop
worker produced two `failed` records for Tasks whose escrow had already been funded.

The worker re-reads a Task immediately before claiming it, which closes most of the window, but
it is not a lock. Before starting a second instance, stop the first:

```bash
railway down --service coworker --yes   # stop the hosted worker
lsof -ti:4030 | xargs kill              # stop a local worker
```

A worker that is stopped mid-Task does not lose it: payment state is on disk, and the next
worker to start adopts anything still in flight rather than paying again.
