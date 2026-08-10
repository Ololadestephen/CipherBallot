import { getAddress, getBytes, hexlify, isHexString, keccak256, randomBytes } from "ethers";
import { BOT_CHAIN, CONTRACT_ADDRESS } from "./network.ts";

export const COMMITTEE_HANDOFF_VERSION = "cipherballot-committee-handoff-v1";

export type CommitteeHandoffPackage = {
  version: typeof COMMITTEE_HANDOFF_VERSION;
  proposalId: number;
  contractAddress: string;
  chainId: number;
  iv: string;
  ciphertext: string;
  keyCommitment: string;
};

type HandoffContext = { chainId: number; contractAddress: string };

function defaultContext(): HandoffContext {
  return { chainId: BOT_CHAIN.chainId, contractAddress: CONTRACT_ADDRESS };
}

function handoffAad(proposalId: number, context: HandoffContext) {
  return new TextEncoder().encode(
    `${COMMITTEE_HANDOFF_VERSION}:${context.chainId}:${getAddress(context.contractAddress).toLowerCase()}:${proposalId}`
  );
}

function bytesToBase64Url(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("The encrypted handoff package is malformed.");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function generateCommitteeHandoffKey() {
  return hexlify(randomBytes(32));
}

export function normalizeCommitteeHandoffKey(value: string) {
  const key = value.trim().startsWith("0x") ? value.trim() : `0x${value.trim()}`;
  if (!isHexString(key, 32)) throw new Error("This committee portal link does not contain a valid handoff key.");
  return key.toLowerCase();
}

export async function encryptCommitteeHandoff(
  proposalId: number,
  recoveryKitJson: string,
  handoffKey: string,
  context: HandoffContext = defaultContext()
): Promise<CommitteeHandoffPackage> {
  const normalizedKey = normalizeCommitteeHandoffKey(handoffKey);
  const key = await crypto.subtle.importKey("raw", getBytes(normalizedKey), "AES-GCM", false, ["encrypt"]);
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: handoffAad(proposalId, context), tagLength: 128 },
    key,
    new TextEncoder().encode(recoveryKitJson)
  );
  return {
    version: COMMITTEE_HANDOFF_VERSION,
    proposalId,
    contractAddress: getAddress(context.contractAddress),
    chainId: context.chainId,
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    keyCommitment: keccak256(normalizedKey)
  };
}

export async function decryptCommitteeHandoff(
  proposalId: number,
  handoffPackage: CommitteeHandoffPackage,
  handoffKey: string,
  context: HandoffContext = defaultContext()
) {
  const normalizedKey = normalizeCommitteeHandoffKey(handoffKey);
  if (handoffPackage.version !== COMMITTEE_HANDOFF_VERSION
    || handoffPackage.proposalId !== proposalId
    || handoffPackage.chainId !== context.chainId
    || getAddress(handoffPackage.contractAddress) !== getAddress(context.contractAddress)
    || handoffPackage.keyCommitment.toLowerCase() !== keccak256(normalizedKey).toLowerCase()) {
    throw new Error("This handoff package does not match the selected proposal or portal link.");
  }
  const key = await crypto.subtle.importKey("raw", getBytes(normalizedKey), "AES-GCM", false, ["decrypt"]);
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlToBytes(handoffPackage.iv),
        additionalData: handoffAad(proposalId, context),
        tagLength: 128
      },
      key,
      base64UrlToBytes(handoffPackage.ciphertext)
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error("The committee package could not be decrypted. Open the original committee portal link and try again.");
  }
}
