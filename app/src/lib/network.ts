export const BOT_CHAIN = {
  chainId: 968,
  chainHex: "0x3c8",
  name: "BOT Chain Testnet",
  rpcUrl: import.meta.env?.VITE_BOTCHAIN_RPC_URL || "https://rpc.bohr.life",
  explorerUrl: import.meta.env?.VITE_BOTCHAIN_EXPLORER_URL || "https://scan.bohr.life",
  nativeCurrency: {
    name: "BOT",
    symbol: "BOT",
    decimals: 18
  }
};

export const CONTRACT_ADDRESS = (import.meta.env?.VITE_CIPHERBALLOT_CONTRACT_ADDRESS || "").trim();
export const CONTRACT_DEPLOYMENT_BLOCK = Number(import.meta.env?.VITE_CIPHERBALLOT_DEPLOYMENT_BLOCK || 19_063_989);
