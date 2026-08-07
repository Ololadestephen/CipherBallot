import {
  AbiCoder,
  SigningKey,
  concat,
  dataSlice,
  getBytes,
  hexlify,
  isAddress,
  isHexString,
  keccak256,
  randomBytes,
  toUtf8Bytes
} from "ethers";

export const BALLOT_ENVELOPE_VERSION = "cipherballot-ecdh-aesgcm-v1";

export type BallotEnvelope = {
  version: typeof BALLOT_ENVELOPE_VERSION;
  ephemeralPublicKey: string;
  iv: string;
  ciphertext: string;
};

function createEphemeralKey(): SigningKey {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return new SigningKey(hexlify(randomBytes(32)));
    } catch {
      // Retry the vanishingly unlikely invalid secp256k1 scalar.
    }
  }
  throw new Error("Unable to generate an ephemeral ballot key.");
}

export function ballotAdditionalData(
  chainId: number,
  contractAddress: string,
  proposalId: number
): string {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Invalid chain ID.");
  if (!Number.isSafeInteger(proposalId) || proposalId <= 0) throw new Error("Invalid proposal ID.");
  if (!isAddress(contractAddress)) throw new Error("Invalid CipherBallot contract address.");
  return AbiCoder.defaultAbiCoder().encode(
    ["string", "uint256", "address", "uint256"],
    [BALLOT_ENVELOPE_VERSION, chainId, contractAddress, proposalId]
  );
}

export async function encryptBallotEnvelope({
  optionIndex,
  proposalId,
  voter,
  encryptionPublicKey,
  chainId,
  contractAddress
}: {
  optionIndex: number;
  proposalId: number;
  voter: string;
  encryptionPublicKey: string;
  chainId: number;
  contractAddress: string;
}) {
  if (!Number.isSafeInteger(optionIndex) || optionIndex < 0) throw new Error("Invalid ballot option.");
  if (!isAddress(voter)) throw new Error("Invalid ballot owner address.");
  if (!isHexString(encryptionPublicKey, 65) || !encryptionPublicKey.startsWith("0x04")) {
    throw new Error("This proposal does not have a valid V2 election public key.");
  }

  const ephemeralKey = createEphemeralKey();
  const sharedPoint = ephemeralKey.computeSharedSecret(encryptionPublicKey);
  const sharedX = dataSlice(sharedPoint, 1, 33);
  const additionalData = ballotAdditionalData(chainId, contractAddress, proposalId);
  const aesKeyBytes = getBytes(keccak256(concat([sharedX, getBytes(additionalData)])));
  const aesKey = await globalThis.crypto.subtle.importKey("raw", aesKeyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = randomBytes(12);
  const plaintext = toUtf8Bytes(JSON.stringify({
    version: 1,
    proposalId,
    voter,
    optionIndex,
    salt: hexlify(randomBytes(32))
  }));
  const encrypted = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: getBytes(additionalData), tagLength: 128 },
    aesKey,
    plaintext
  );
  const envelope: BallotEnvelope = {
    version: BALLOT_ENVELOPE_VERSION,
    ephemeralPublicKey: ephemeralKey.publicKey,
    iv: hexlify(iv),
    ciphertext: hexlify(new Uint8Array(encrypted))
  };
  const privateBallot = toUtf8Bytes(JSON.stringify(envelope));
  if (privateBallot.length > 4096) throw new Error("Encrypted ballot envelope exceeds the protocol limit.");
  const privateBallotHash = keccak256(privateBallot);
  const ballotProofHash = keccak256(
    concat([toUtf8Bytes("CipherBallot encrypted ballot proof v1"), getBytes(privateBallotHash)])
  );

  return { privateBallot, privateBallotHash, ballotProofHash, envelope };
}
