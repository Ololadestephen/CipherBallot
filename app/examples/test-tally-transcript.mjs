import assert from "node:assert/strict";
import { keccak256, toUtf8Bytes } from "ethers";

process.env.BOTCHAIN_CHAIN_ID = "968";
process.env.CIPHERBALLOT_CONTRACT_ADDRESS = "0x3C250cBf439431D7dd8525Ca9800c577a9533e3C";

const { validateTallyTranscriptRequest } = await import("../api/v1/tallies.js");

const transcript = {
  version: "cipherballot-tally-transcript-v1",
  chainId: 968,
  contractAddress: process.env.CIPHERBALLOT_CONTRACT_ADDRESS,
  proposalId: 1,
  title: "Community allocation",
  options: ["Yes", "No", "Abstain"],
  finalTally: [1, 1, 0],
  ballotCount: 2,
  ballots: [
    {
      transactionHash: `0x${"11".repeat(32)}`,
      voter: "0x0000000000000000000000000000000000000011",
      privateBallotHash: `0x${"21".repeat(32)}`,
      ballotProofHash: `0x${"31".repeat(32)}`
    },
    {
      transactionHash: `0x${"12".repeat(32)}`,
      voter: "0x0000000000000000000000000000000000000012",
      privateBallotHash: `0x${"22".repeat(32)}`,
      ballotProofHash: `0x${"32".repeat(32)}`
    }
  ]
};

const transcriptJson = JSON.stringify(transcript);
const transcriptHash = keccak256(toUtf8Bytes(transcriptJson));
const validated = validateTallyTranscriptRequest({ transcript: transcriptJson, transcriptHash });
assert.equal(validated.transcriptHash, transcriptHash);
assert.deepEqual(validated.transcript.finalTally, [1, 1, 0]);

assert.throws(
  () => validateTallyTranscriptRequest({ transcript: transcriptJson, transcriptHash: `0x${"44".repeat(32)}` }),
  /does not match/i
);

const duplicateTranscript = {
  ...transcript,
  ballots: [transcript.ballots[0], { ...transcript.ballots[1], voter: transcript.ballots[0].voter }]
};
const duplicateJson = JSON.stringify(duplicateTranscript);
assert.throws(
  () => validateTallyTranscriptRequest({ transcript: duplicateJson, transcriptHash: keccak256(toUtf8Bytes(duplicateJson)) }),
  /duplicate/i
);

const inconsistentTranscript = { ...transcript, finalTally: [2, 1, 0] };
const inconsistentJson = JSON.stringify(inconsistentTranscript);
assert.throws(
  () => validateTallyTranscriptRequest({ transcript: inconsistentJson, transcriptHash: keccak256(toUtf8Bytes(inconsistentJson)) }),
  /must equal/i
);

console.log(JSON.stringify({ result: "passed", transcriptHash, ballotCount: transcript.ballotCount }));
