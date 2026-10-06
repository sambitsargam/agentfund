import data from "./data/public-threats.json";

export interface ReputationCheck {
  address: string; network: "mainnet"; listed: boolean; sources: string[]; sourceCommit: string;
  meaning: string; scope: string;
}
/** Exact address association only; no name matching, address clustering or inferred safe labels. */
export function lookupPublicReputation(address: string): ReputationCheck {
  const matches = data.rows.filter(r => r.address === address);
  return { address, network: "mainnet", listed: matches.length > 0, sources: matches.map(r => r.source), sourceCommit: data.sourceCommit,
    meaning: matches.length ? "Eternl Guard lists this address as associated with a reported threat. Pause and inspect the source before paying. This is an external report, not a court finding."
      : "No exact match in this small, pinned source snapshot. That does not establish safety or exclude fraud.",
    scope: "Source lookup only; no mainnet history assessment or transaction is performed. Snapshot coverage is incomplete and may become stale." };
}
