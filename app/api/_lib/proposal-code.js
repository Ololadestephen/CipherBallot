import { getAddress, keccak256, toUtf8Bytes } from "ethers";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function proposalCodeFor(chainId, contractAddress, proposalId) {
  if (!Number.isSafeInteger(Number(chainId)) || Number(chainId) < 1) throw new Error("Chain ID is invalid.");
  if (!Number.isSafeInteger(Number(proposalId)) || Number(proposalId) < 1) throw new Error("Proposal ID is invalid.");
  const contract = getAddress(contractAddress);
  const hash = keccak256(toUtf8Bytes(`${Number(chainId)}:${contract.toLowerCase()}:${Number(proposalId)}`));
  let value = BigInt(`0x${hash.slice(2, 12)}`);
  let encoded = "";
  for (let index = 0; index < 8; index += 1) {
    encoded = ALPHABET[Number(value & 31n)] + encoded;
    value >>= 5n;
  }
  return `CB-${encoded.slice(0, 4)}-${encoded.slice(4)}`;
}

export function normalizeProposalCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
}

export function isProposalCode(value) {
  return /^CB-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(String(value || "").trim().toUpperCase());
}
