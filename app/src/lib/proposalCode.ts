import { getAddress, keccak256, toUtf8Bytes } from "ethers";
import type { ProposalView } from "./evm";
import { BOT_CHAIN, CONTRACT_ADDRESS } from "./network.ts";

const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 8;

export function proposalCode(
  proposalId: number,
  context: { chainId: number; contractAddress: string } = { chainId: BOT_CHAIN.chainId, contractAddress: CONTRACT_ADDRESS }
) {
  if (!Number.isSafeInteger(proposalId) || proposalId < 1) throw new Error("Proposal ID must be a positive integer.");
  const contract = getAddress(context.contractAddress);
  const hash = keccak256(toUtf8Bytes(`${context.chainId}:${contract.toLowerCase()}:${proposalId}`));
  let value = BigInt(`0x${hash.slice(2, 12)}`);
  let encoded = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    encoded = CODE_ALPHABET[Number(value & 31n)] + encoded;
    value >>= 5n;
  }
  return `CB-${encoded.slice(0, 4)}-${encoded.slice(4)}`;
}

export function normalizeProposalCode(value: string) {
  return value.trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
}

export function proposalMatchesCode(proposal: ProposalView, code: string) {
  return normalizeProposalCode(proposalCode(proposal.id)) === normalizeProposalCode(code);
}

export function committeePortalPath(proposalId: number) {
  return `/committee/${proposalCode(proposalId)}`;
}
