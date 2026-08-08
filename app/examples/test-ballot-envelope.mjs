import assert from "node:assert/strict";
import {
  SigningKey,
  concat,
  dataSlice,
  getBytes,
  hexlify,
  isHexString,
  keccak256,
  randomBytes,
  toUtf8Bytes
} from "ethers";
import {
  BALLOT_ENVELOPE_VERSION,
  ballotAdditionalData,
  decryptBallot,
  encryptBallot,
  generateElectionKeyPair
} from "./lib/ballot-envelope.mjs";

const keyPair = generateElectionKeyPair();
assert.equal(isHexString(keyPair.privateKey, 32), true);
assert.equal(isHexString(keyPair.publicKey, 65), true);
const context = {
  optionIndex: 1,
  proposalId: 42,
  voter: "0x000000000000000000000000000000000000a11c",
  encryptionPublicKey: keyPair.publicKey,
  chainId: 968,
  contractAddress: "0x000000000000000000000000000000000000c1f3"
};
const encrypted = encryptBallot(context);
const decrypted = decryptBallot({
  privateBallot: encrypted.privateBallot,
  electionPrivateKey: keyPair.privateKey,
  proposalId: context.proposalId,
  chainId: context.chainId,
  contractAddress: context.contractAddress
});

assert.equal(decrypted.proposalId, context.proposalId);
assert.equal(decrypted.voter.toLowerCase(), context.voter.toLowerCase());
assert.equal(decrypted.optionIndex, context.optionIndex);

assert.throws(() => decryptBallot({
  privateBallot: encrypted.privateBallot,
  electionPrivateKey: keyPair.privateKey,
  proposalId: context.proposalId + 1,
  chainId: context.chainId,
  contractAddress: context.contractAddress
}));

const ephemeral = new SigningKey(hexlify(randomBytes(32)));
const sharedPoint = ephemeral.computeSharedSecret(keyPair.publicKey);
const sharedX = dataSlice(sharedPoint, 1, 33);
const additionalData = ballotAdditionalData(context.chainId, context.contractAddress, context.proposalId);
const browserAesKey = await globalThis.crypto.subtle.importKey(
  "raw",
  getBytes(keccak256(concat([sharedX, getBytes(additionalData)]))),
  "AES-GCM",
  false,
  ["encrypt"]
);
const browserIv = randomBytes(12);
const browserPlaintext = toUtf8Bytes(JSON.stringify({
  version: 1,
  proposalId: context.proposalId,
  voter: context.voter,
  optionIndex: context.optionIndex,
  salt: hexlify(randomBytes(32))
}));
const browserCiphertext = await globalThis.crypto.subtle.encrypt(
  { name: "AES-GCM", iv: browserIv, additionalData: getBytes(additionalData), tagLength: 128 },
  browserAesKey,
  browserPlaintext
);
const browserEnvelope = hexlify(toUtf8Bytes(JSON.stringify({
  version: BALLOT_ENVELOPE_VERSION,
  ephemeralPublicKey: ephemeral.publicKey,
  iv: hexlify(browserIv),
  ciphertext: hexlify(new Uint8Array(browserCiphertext))
})));
const browserDecrypted = decryptBallot({
  privateBallot: browserEnvelope,
  electionPrivateKey: keyPair.privateKey,
  proposalId: context.proposalId,
  chainId: context.chainId,
  contractAddress: context.contractAddress
});
assert.equal(browserDecrypted.optionIndex, context.optionIndex);

console.log("Node/browser ballot interoperability and context binding passed.");
