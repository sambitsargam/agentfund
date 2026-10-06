type Io = { address: string; amount: { unit: string; quantity: string }[]; collateral?: boolean; reference?: boolean };
export function fundingMatches(proof: { tx: { block_height: number }; utxos: { inputs: Io[]; outputs: Io[] }; metadata: { label: string; json_metadata: unknown }[] }, terms: { investor: string; recipient: string; lovelace: bigint; digest: string }) {
  const sum = (ios: Io[], address: string) => ios.filter(i => i.address === address && !i.collateral && !i.reference)
    .reduce((s, i) => s + BigInt(i.amount.find(a => a.unit === "lovelace")?.quantity ?? "0"), 0n);
  return proof.tx.block_height > 0 && sum(proof.utxos.inputs, terms.investor) > 0n
    && sum(proof.utxos.outputs, terms.recipient) - sum(proof.utxos.inputs, terms.recipient) === terms.lovelace
    && proof.metadata.some(m => m.label === "674" && Array.isArray(m.json_metadata) && m.json_metadata.includes(terms.digest));
}
