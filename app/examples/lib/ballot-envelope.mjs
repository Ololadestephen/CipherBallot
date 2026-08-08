import { createCipheriv, createDecipheriv, createECDH, randomBytes } from "node:crypto";
import {
  AbiCoder,
  concat,
  getBytes,
  hexlify,
  isAddress,
  isHexString,
  keccak256,
  toUtf8Bytes,
  toUtf8String
} from "ethers";

export const BALLOT_ENVELOPE_VERSION = "cipherballot-ecdh-aesgcm-v1";
export const MAX_BALLOT_ENVELOPE_BYTES = 4096;

export function generateElectionKeyPair() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const ecdh = createECDH("secp256k1");
    const privateKey = randomBytes(32);
    try {
      ecdh.setPrivateKey(privateKey);
      return {
        privateKey: hexlify(privateKey),
        publicKey: hexlify(ecdh.getPublicKey(undefined, "uncompressed"))
      };
    } catch {
      // Retry the vanishingly unlikely invalid secp256k1 scalar.
    }
  }
  throw new Error("Unable to generate a valid election key.");
}

export function publicKeyFromPrivateKey(privateKey) {
  if (!isHexString(privateKey, 32)) throw new Error("Election private key must be 32-byte hex.");
  const ecdh = createECDH("secp256k1");
  ecdh.setPrivateKey(Buffer.from(getBytes(privateKey)));
  return hexlify(ecdh.getPublicKey(undefined, "uncompressed"));
}

export function ballotAdditionalData(chainId, contractAddress, proposalId) {
  if (!isAddress(contractAddress)) throw new Error("Invalid CipherBallot contract address.");
  if (!Number.isSafeInteger(Number(chainId)) || Number(chainId) <= 0) throw new Error("Invalid chain ID.");
  if (!Number.isSafeInteger(Number(proposalId)) || Number(proposalId) <= 0) throw new Error("Invalid proposal ID.");
  return AbiCoder.defaultAbiCoder().encode(
    ["string", "uint256", "address", "uint256"],
    [BALLOT_ENVELOPE_VERSION, chainId, contractAddress, proposalId]
  );
}

function parseEnvelope(privateBallot) {
  if (!isHexString(privateBallot) || privateBallot === "0x") throw new Error("Ballot envelope must be non-empty hex.");
  if (getBytes(privateBallot).length > MAX_BALLOT_ENVELOPE_BYTES) throw new Error("Ballot envelope exceeds 4096 bytes.");
  let envelope;
  try {
    envelope = JSON.parse(toUtf8String(privateBallot));
  } catch {
    throw new Error("Ballot envelope must contain valid UTF-8 JSON.");
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new Error("Invalid ballot envelope.");
  const allowed = new Set(["version", "ephemeralPublicKey", "iv", "ciphertext"]);
  if (Object.keys(envelope).some((field) => !allowed.has(field))) throw new Error("Ballot envelope contains unknown fields.");
  if (envelope.version !== BALLOT_ENVELOPE_VERSION) throw new Error("Unsupported ballot envelope version.");
  if (!isHexString(envelope.ephemeralPublicKey, 65) || !envelope.ephemeralPublicKey.startsWith("0x04")) {
    throw new Error("Invalid ephemeral public key.");
  }
  if (!isHexString(envelope.iv, 12)) throw new Error("Invalid AES-GCM IV.");
  if (!isHexString(envelope.ciphertext) || getBytes(envelope.ciphertext).length < 17) {
    throw new Error("Invalid AES-GCM ciphertext.");
  }
  return envelope;
}

function deriveAesKey(privateKey, publicKey, additionalData) {
  if (!isHexString(privateKey, 32)) throw new Error("Election private key must be 32-byte hex.");
  const ecdh = createECDH("secp256k1");
  ecdh.setPrivateKey(Buffer.from(getBytes(privateKey)));
  const sharedX = ecdh.computeSecret(Buffer.from(getBytes(publicKey)));
  return Buffer.from(getBytes(keccak256(concat([sharedX, getBytes(additionalData)]))));
}

export function encryptedBallotProofHash(privateBallot) {
  const privateBallotHash = keccak256(privateBallot);
  return keccak256(
    concat([toUtf8Bytes("CipherBallot encrypted ballot proof v1"), getBytes(privateBallotHash)])
  );
}

export function encryptBallot({ optionIndex, proposalId, voter, encryptionPublicKey, chainId, contractAddress }) {
  if (!Number.isInteger(optionIndex) || optionIndex < 0) throw new Error("optionIndex must be a non-negative integer.");
  if (!isAddress(voter)) throw new Error("Invalid voter address.");
  if (!isHexString(encryptionPublicKey, 65) || !encryptionPublicKey.startsWith("0x04")) {
    throw new Error("Proposal election public key must be uncompressed 65-byte secp256k1 hex.");
  }

  const ephemeral = generateElectionKeyPair();
  const additionalData = ballotAdditionalData(chainId, contractAddress, proposalId);
  const aesKey = deriveAesKey(ephemeral.privateKey, encryptionPublicKey, additionalData);
  const iv = randomBytes(12);
  const plaintext = Buffer.from(JSON.stringify({
    version: 1,
    proposalId: Number(proposalId),
    voter,
    optionIndex,
    salt: hexlify(randomBytes(32))
  }));
  const cipher = createCipheriv("aes-256-gcm", aesKey, iv);
  cipher.setAAD(Buffer.from(getBytes(additionalData)));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const ciphertext = Buffer.concat([encrypted, cipher.getAuthTag()]);
  const envelope = {
    version: BALLOT_ENVELOPE_VERSION,
    ephemeralPublicKey: ephemeral.publicKey,
    iv: hexlify(iv),
    ciphertext: hexlify(ciphertext)
  };
  const privateBallot = hexlify(toUtf8Bytes(JSON.stringify(envelope)));

  return {
    privateBallot,
    privateBallotHash: keccak256(privateBallot),
    ballotProofHash: encryptedBallotProofHash(privateBallot),
    envelope
  };
}

export function decryptBallot({ privateBallot, electionPrivateKey, proposalId, chainId, contractAddress }) {
  const envelope = parseEnvelope(privateBallot);
  const additionalData = ballotAdditionalData(chainId, contractAddress, proposalId);
  const aesKey = deriveAesKey(electionPrivateKey, envelope.ephemeralPublicKey, additionalData);
  const ciphertext = Buffer.from(getBytes(envelope.ciphertext));
  const encrypted = ciphertext.subarray(0, -16);
  const authTag = ciphertext.subarray(-16);
  const decipher = createDecipheriv("aes-256-gcm", aesKey, Buffer.from(getBytes(envelope.iv)));
  decipher.setAAD(Buffer.from(getBytes(additionalData)));
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  let ballot;
  try {
    ballot = JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new Error("Decrypted ballot is not valid JSON.");
  }
  if (!ballot || typeof ballot !== "object" || Array.isArray(ballot)) throw new Error("Invalid decrypted ballot.");
  const allowed = new Set(["version", "proposalId", "voter", "optionIndex", "salt"]);
  if (Object.keys(ballot).some((field) => !allowed.has(field))) throw new Error("Decrypted ballot contains unknown fields.");
  if (ballot.version !== 1 || Number(ballot.proposalId) !== Number(proposalId)) throw new Error("Decrypted ballot context mismatch.");
  if (!isAddress(ballot.voter)) throw new Error("Decrypted ballot voter is invalid.");
  if (!Number.isSafeInteger(ballot.optionIndex) || ballot.optionIndex < 0) throw new Error("Decrypted ballot option is invalid.");
  if (!isHexString(ballot.salt, 32)) throw new Error("Decrypted ballot salt is invalid.");
  return ballot;
}

export function validateBallotEnvelope(privateBallot) {
  parseEnvelope(privateBallot);
  return true;
}
