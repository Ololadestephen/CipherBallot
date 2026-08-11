const configuredChainId = Number.parseInt(String(import.meta.env?.VITE_BOTCHAIN_CHAIN_ID || "968"), 10);

if (!Number.isSafeInteger(configuredChainId) || configuredChainId <= 0) {
  throw new Error("VITE_BOTCHAIN_CHAIN_ID must be a positive integer.");
}

const mainnet = configuredChainId === 677;

export const BOT_CHAIN = {
  chainId: configuredChainId,
  chainHex: `0x${configuredChainId.toString(16)}`,
  name: (import.meta.env?.VITE_BOTCHAIN_NETWORK_NAME || (mainnet ? "BOT Chain Mainnet" : "BOT Chain Testnet")).trim(),
  rpcUrl: import.meta.env?.VITE_BOTCHAIN_RPC_URL || (mainnet ? "https://rpc.botchain.ai" : "https://rpc.bohr.life"),
  explorerUrl: import.meta.env?.VITE_BOTCHAIN_EXPLORER_URL || (mainnet ? "https://scan.botchain.ai" : "https://scan.bohr.life"),
  nativeCurrency: {
    name: "BOT",
    symbol: "BOT",
    decimals: 18
  }
};

export const CONTRACT_ADDRESS = (import.meta.env?.VITE_CIPHERBALLOT_CONTRACT_ADDRESS || "").trim();
export const CONTRACT_DEPLOYMENT_BLOCK = Number(
  import.meta.env?.VITE_CIPHERBALLOT_DEPLOYMENT_BLOCK || (mainnet ? 0 : 19_063_989)
);
