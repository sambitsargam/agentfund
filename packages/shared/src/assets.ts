export const NETWORK = "cardano:preprod" as const;

export const TUSDM_ASSET_NAME = "0014df10745553444d";
export const TUSDM_DECIMALS = 6;

/** tUSDM used by x402 (`USDM_PREPROD_ASSET` in @x402/cardano). */
export const TUSDM_X402_POLICY = "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9";
/** tUSDM used by Masumi escrow and dispenser.masumi.network. */
export const TUSDM_MASUMI_POLICY = "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde";

/** Asset units as Blockfrost and the ledger spell them: policy id + asset name, no separator. */
export const TUSDM_X402_UNIT = TUSDM_X402_POLICY + TUSDM_ASSET_NAME;
export const TUSDM_MASUMI_UNIT = TUSDM_MASUMI_POLICY + TUSDM_ASSET_NAME;
export const TUSDM_UNITS = [TUSDM_X402_UNIT, TUSDM_MASUMI_UNIT] as const;

/** ADA Handle policy; the same policy id is used on preprod. */
export const ADA_HANDLE_POLICY = "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a";
/** CIP-68 (222) user-token label prefix used by newer handles. */
export const CIP68_USER_TOKEN_LABEL = "000de140";

export const BLOCKFROST_PREPROD_URL = "https://cardano-preprod.blockfrost.io/api/v0";
export const KOIOS_PREPROD_URL = "https://preprod.koios.rest/api/v1";

export function formatTusdm(baseUnits: bigint): string {
  const whole = baseUnits / 1_000_000n;
  const frac = (baseUnits % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function formatAda(lovelace: bigint): string {
  return formatTusdm(lovelace);
}
