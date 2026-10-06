/**
 * The funding deal behind Atlas. These terms are baked into the splitter's script hash,
 * so changing any of them produces a new splitter address.
 */
export interface DealTerms {
  agentId: string;
  atlasAddress: string;
  investors: { name: string; address: string; bps: number }[];
}

/** Current registered preprod collection wallet; override after a registration migration. */
export const ATLAS_MASUMI_PAYOUT_ADDRESS =
  "addr_test1qpmdzh7surd5r6kvanvcmg6wam6nn9n0ec5mp5v0t0dhtmzdfav2l3umddzyjsdjgc2vnrx3aj3y4t0d2r059njfvg7q5pwayf";

export const ATLAS_DEAL: DealTerms = {
  agentId: "atlas",
  atlasAddress:
    "addr_test1qrseuc9dfg2qdn7vkg35lxnpzjk4y67nemcmmkc2k5t2yk6ddv3uplh7wk4p468pte5fpxgckpmuu2jcuk5vr2qpgz2q7gyegt",
  investors: [
    {
      name: "Investor A",
      address:
        "addr_test1qqwdk97gwef6ypkjcd9hhgpls8ela9fdvee2wvaxnkmjqdtj5pvye96gvjtm2jv70mtyqsczypsl8f2d3dgtlcmktk0sv74rjj",
      bps: 1000,
    },
  ],
};

/**
 * A funding round's terms. Unlike {@link ATLAS_DEAL}, where the investor's share is a fixed
 * script parameter, a round is a lifecycle: the share activates only once the investor's
 * capital reaches the operator, and it stops once cumulative payouts reach the cap. Terms and
 * the seed reference together determine the round's address, so neither can change afterwards.
 */
export interface RoundTermsConfig {
  operator: string;
  /** Governed asset. Capital, payouts and the cap are all denominated in it. */
  policy: string;
  name: string;
  capital: string;
  bps: number;
  cap: string;
}

/** 0.20 tUSDM for half of Atlas's x402 earnings, until 0.30 tUSDM has been repaid. */
export const ATLAS_ROUND_TERMS: RoundTermsConfig = {
  operator: ATLAS_DEAL.atlasAddress,
  policy: "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9",
  name: "0014df10745553444d",
  capital: "200000",
  bps: 5000,
  cap: "300000",
};
