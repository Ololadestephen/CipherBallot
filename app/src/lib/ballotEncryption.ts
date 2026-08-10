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

export type DecryptedBallot = {
  version: 1;
  proposalId: number;
  voter: string;
  optionIndex: number;
  salt: string;
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

function parseBallotEnvelope(privateBallot: string): BallotEnvelope {
  if (!isHexString(privateBallot) || privateBallot === "0x") throw new Error("Ballot envelope must be non-empty hex.");
  const encoded = getBytes(privateBallot);
  if (encoded.length > 4096) throw new Error("Ballot envelope exceeds the protocol limit.");

  let envelope: unknown;
  try {
    envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(encoded));
  } catch {
    throw new Error("Ballot envelope does not contain valid UTF-8 JSON.");
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new Error("Ballot envelope has an invalid structure.");
  }

  const value = envelope as Record<string, unknown>;
  const allowedFields = new Set(["version", "ephemeralPublicKey", "iv", "ciphertext"]);
  if (Object.keys(value).some((field) => !allowedFields.has(field))) {
    throw new Error("Ballot envelope contains unknown fields.");
  }
  if (value.version !== BALLOT_ENVELOPE_VERSION) throw new Error("Ballot envelope uses an unsupported version.");
  if (typeof value.ephemeralPublicKey !== "string" || !isHexString(value.ephemeralPublicKey, 65) || !value.ephemeralPublicKey.startsWith("0x04")) {
    throw new Error("Ballot envelope has an invalid ephemeral public key.");
  }
  if (typeof value.iv !== "string" || !isHexString(value.iv, 12)) {
    throw new Error("Ballot envelope has an invalid AES-GCM IV.");
  }
  if (typeof value.ciphertext !== "string" || !isHexString(value.ciphertext) || getBytes(value.ciphertext).length < 17) {
    throw new Error("Ballot envelope has invalid ciphertext.");
  }

  return value as BallotEnvelope;
}

export function encryptedBallotProofHash(privateBallot: string) {
  const privateBallotHash = keccak256(privateBallot);
  return keccak256(
    concat([toUtf8Bytes("CipherBallot encrypted ballot proof v1"), getBytes(privateBallotHash)])
  );
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
  const ballotProofHash = encryptedBallotProofHash(hexlify(privateBallot));

  return { privateBallot, privateBallotHash, ballotProofHash, envelope };
}

export async function decryptBallotEnvelope({
  privateBallot,
  electionPrivateKey,
  proposalId,
  chainId,
  contractAddress
}: {
  privateBallot: string;
  electionPrivateKey: string;
  proposalId: number;
  chainId: number;
  contractAddress: string;
}): Promise<DecryptedBallot> {
  if (!isHexString(electionPrivateKey, 32)) throw new Error("Election private key must be 32-byte hex.");
  const envelope = parseBallotEnvelope(privateBallot);
  const additionalData = ballotAdditionalData(chainId, contractAddress, proposalId);
  const sharedPoint = new SigningKey(electionPrivateKey).computeSharedSecret(envelope.ephemeralPublicKey);
  const sharedX = dataSlice(sharedPoint, 1, 33);
  const aesKeyBytes = getBytes(keccak256(concat([sharedX, getBytes(additionalData)])));
  const aesKey = await globalThis.crypto.subtle.importKey("raw", aesKeyBytes, "AES-GCM", false, ["decrypt"]);

  let decoded: unknown;
  try {
    const plaintext = await globalThis.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: getBytes(envelope.iv),
        additionalData: getBytes(additionalData),
        tagLength: 128
      },
      aesKey,
      getBytes(envelope.ciphertext)
    );
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
  } catch {
    throw new Error("Ballot decryption failed. The recovery key or encrypted envelope is invalid.");
  }

  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("Decrypted ballot has an invalid structure.");
  }
  const ballot = decoded as Record<string, unknown>;
  const allowedFields = new Set(["version", "proposalId", "voter", "optionIndex", "salt"]);
  if (Object.keys(ballot).some((field) => !allowedFields.has(field))) {
    throw new Error("Decrypted ballot contains unknown fields.");
  }
  if (ballot.version !== 1 || ballot.proposalId !== proposalId) throw new Error("Decrypted ballot context does not match this proposal.");
  if (typeof ballot.voter !== "string" || !isAddress(ballot.voter)) throw new Error("Decrypted ballot voter is invalid.");
  if (!Number.isSafeInteger(ballot.optionIndex) || Number(ballot.optionIndex) < 0) throw new Error("Decrypted ballot option is invalid.");
  if (typeof ballot.salt !== "string" || !isHexString(ballot.salt, 32)) throw new Error("Decrypted ballot salt is invalid.");

  return ballot as unknown as DecryptedBallot;
}
