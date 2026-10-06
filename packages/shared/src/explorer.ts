const CARDANOSCAN = "https://preprod.cardanoscan.io";
const BASESCAN = "https://sepolia.basescan.org";

export const cardanoscan = {
  tx: (hash: string) => `${CARDANOSCAN}/transaction/${hash}`,
  address: (address: string) => `${CARDANOSCAN}/address/${address}`,
  stake: (stakeAddress: string) => `${CARDANOSCAN}/stakekey/${stakeAddress}`,
  pool: (poolId: string) => `${CARDANOSCAN}/pool/${poolId}`,
};

export const basescan = {
  tx: (hash: string) => `${BASESCAN}/tx/${hash}`,
  address: (address: string) => `${BASESCAN}/address/${address}`,
};
