# Build log

Times are Singapore time (UTC+8).

## 6 October

### Repository
- `sambitsargam/agentfund` created private; first commit `d3c1043`.

### Hosted facilitator (Cardano proof)
- URL: `https://x402.preprod.dev.ecosyseng.cf-deployments.org` (Cardano Foundation, preprod).
- `GET /supported`: `exact` on `cardano:preprod`, x402 v2, `assetTransferMethods: [default, masumi, script]`, `areFeesSponsored: false`, `l1Confirmations` 0–20.
- Decision: `script` is supported, so splitter payments settle through the hosted facilitator. No self-hosted facilitator is needed.
- **Proof payment (11:05):** x402 `script` method, 2 tADA locked at a PlutusV3 script `addr_test1wrmkwusv4wv6u8m2fvm326xr224tu7qclgpetxf4s8x77jg2frp7d` with inline datum `d8799f496167656e7466756e64ff`. HTTP 200 after 32.2 s, settlement `confirmed`, block 5259033, fee 0.172013 tADA.
  - Tx [`713c490c887a53a854029a1be96430e6e2489636f7a14181664ca78a0ba3849b`](https://preprod.cardanoscan.io/transaction/713c490c887a53a854029a1be96430e6e2489636f7a14181664ca78a0ba3849b)

### Two tUSDM tokens on preprod
Both use asset name `0014df10745553444d` (CIP-68 fungible label + `tUSDM`). Units below are policy id + asset name with no dot.

| Policy | Supply (base units) | Decimals | Who uses it |
| --- | --- | --- | --- |
| `e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9` | 20,120,457,000,000 | 6 (SDK `USDM_DEFAULT_DECIMALS`; no registry metadata) | `@x402/cardano` 2.26.0 `USDM_PREPROD_ASSET`, the default asset in x402 spend controls; tusdm.moneta.global claim |
| `16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde` | 10,535,544,238,003 | 6 (token registry, ticker `tUSDM`) | Masumi: `dispenser.masumi.network`, escrow payouts, TOKEN2049 agent guide |

- An x402 buyer pays `e675b46e…` by default. Paying `16a55b2a…` over x402 requires an explicit `spendControls.allowedAssets` entry on the buyer; the facilitator checks asset and amount against the requirements and does not restrict the policy.
- Consequence: the splitter is parameterised with both units, and earnings are the sum of both.
