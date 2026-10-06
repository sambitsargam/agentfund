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
export const ATLAS_MASUMI_PAYOUT_ADDRESS = "addr_test1qpmdzh7surd5r6kvanvcmg6wam6nn9n0ec5mp5v0t0dhtmzdfav2l3umddzyjsdjgc2vnrx3aj3y4t0d2r059njfvg7q5pwayf";

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
