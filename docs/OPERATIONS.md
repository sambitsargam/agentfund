# Running Atlas, and keeping it running

Atlas is meant to stay available after the hackathon. This is what it takes.

## What has to be running

| Process | Port | Why it must stay up | If it stops |
| --- | --- | --- | --- |
| `services/atlas` | 4021 | Serves the paid `/report` route, the free `/probe` the rating workflow calls, `/sample` for the auditors, and the x402 manifest the Masumi registration points at | Agent payments fail; the rating drops to 0 for the probe and latency |
| `services/coworker` | 4030 | Polls Sokosumi for Tasks and drives the Masumi paid flow | Tasks sit unanswered; a paid Task in flight can miss its result deadline |
| Masumi payment service | 3012 | Signs seller terms, tracks escrow, submits result hashes, collects | Paid Tasks cannot start, and a Task waiting on collection stalls |
| PostgreSQL | 5432 | MPS state, including the encrypted wallets | MPS cannot start |
| `services/keeper` | — | Splits locked payments | Payments pile up in the contract; nothing is lost, they settle on the next run |
| `apps/web` | 3000 | The dashboard | Judges and investors cannot see the state |

The keeper and the rating refresh are schedules, not daemons: `scripts/rating-loop.sh` runs the rating workflow every 15 minutes, which is what keeps the gate's one-hour freshness rule satisfied.

## Hosting

The shape that fits is Railway for anything long-running plus Vercel for the dashboard.

**Railway** — one service each for Atlas, the Coworker worker, the keeper and MPS, plus managed PostgreSQL.

- Turn **Serverless off** for every service; a sleeping worker misses Tasks and a sleeping MPS misses an escrow transition.
- Set a **restart policy** so a crash recovers on its own.
- Point each service's health check at `/health`.
- Inject secrets as environment variables; never bake a `.env` into an image.
- Attach a volume for the Coworker's `COWORKER_DATA_DIR`. Task state lives there, and a container-local file disappears on redeploy, which is exactly when a paid Task would be repeated.

**Vercel** — the dashboard. It needs `BLOCKFROST_PROJECT_ID`, `COWORKER_URL` and `BASE_SEPOLIA_RPC`. Leave `DEMO_ACTIONS` unset in production unless the buttons should run real payments; the caps in `apps/web/lib/jobs.ts` exist for when it is on.

After deploying Atlas, point the registration at its public URL:

```bash
npm run register -w @agentfund/coworker -- url https://atlas.example.com/.well-known/x402.json
```

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

## Costs

Everything below is testnet today; these are the mainnet equivalents.

| Item | Rough cost |
| --- | --- |
| Hosting (Railway: 4 small services + Postgres) | $20–40 / month |
| Dashboard (Vercel hobby) | $0 |
| Blockfrost | Free tier covers ~50k requests/day; a report uses 11–14 |
| OpenAI auditors | About $0.002 per gated payment at current `gpt-4.1-mini` / `gpt-4o-mini` prices |
| Cardano fees | ~0.17 ADA per payment (paid by the buyer), ~0.27 ADA per distribution batch (paid by Atlas) |
| Masumi protocol fee | 5% of escrow payments |

At 0.50 tUSDM per report, Atlas covers its hosting at roughly 100 reports a month.

## Key rotation

| Secret | Where it lives | Rotating it |
| --- | --- | --- |
| Blockfrost project id | `.env`, host env | Create a new project, swap the value, restart |
| Coworker runtime key | `services/coworker/.env.local` | `sokosumi --preprod coworkers api-key <id>`, then re-import to the vault |
| MPS runtime token | `services/coworker/.env.local` | Create a new scoped key in the MPS dashboard, delete the old one |
| MPS `ENCRYPTION_KEY` | MPS `.env` | **Do not rotate casually**: it decrypts the stored wallets. Back it up separately from the database |
| OpenAI key | `workflows/payment-gate/.env` | Swap and re-run the gate |
| Cardano mnemonics | `.env`, never committed | Move funds to a new wallet, update the deal, redeploy the splitter (the address changes) |

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
