import assert from "node:assert/strict";

process.env.BOTCHAIN_CHAIN_ID = "968";
process.env.CIPHERBALLOT_CONTRACT_ADDRESS = "0x1111111111111111111111111111111111111111";
process.env.AGENT_RELAY_STORE = "memory";
delete process.env.VERCEL_ENV;

const {
  acquireRelayLock,
  consumeCommitteeChallenge,
  consumeRateLimit,
  createCommitteeChallenge,
  createRelayJob,
  deleteCommitteeHandoff,
  getCommitteeHandoff,
  getTallyTranscript,
  getRelayJob,
  isRelayJobId,
  listCommitteeHandoffRetrievals,
  listCommitteeReadiness,
  markCommitteeHandoffRetrieved,
  normalizeStoredTallyTranscript,
  releaseRelayLock,
  relayJobId,
  saveCommitteeHandoff,
  saveCommitteeReadiness,
  saveTallyTranscript,
  saveRelayJob
} = await import("../api/_lib/relay-store.js");

const request = {
  mode: "public-agent",
  proposalId: "1",
  agent: "0x2222222222222222222222222222222222222222",
  encryptedBallot: "0x1234",
  ballotProofHash: `0x${"33".repeat(32)}`,
  nonce: "0",
  deadline: "2000000000",
  signature: `0x${"44".repeat(65)}`
};
const participants = { ballotOwner: request.agent, ballotSigner: request.agent };
const id = relayJobId(request);
assert.equal(isRelayJobId(id), true);

const first = await createRelayJob(request, participants);
const duplicate = await createRelayJob(request, participants);
assert.equal(first.created, true);
assert.equal(duplicate.created, false);
assert.equal(duplicate.job.id, first.job.id);

const saved = await saveRelayJob({ ...first.job, status: "queued", qstashMessageId: "msg_test" });
assert.equal((await getRelayJob(id)).status, "queued");
assert.equal(saved.qstashMessageId, "msg_test");

const lock = await acquireRelayLock(id);
assert.ok(lock);
assert.equal(await acquireRelayLock(id), null);
await releaseRelayLock(id, "incorrect-token");
assert.equal(await acquireRelayLock(id), null);
await releaseRelayLock(id, lock);
assert.ok(await acquireRelayLock(id));

const firstLimit = await consumeRateLimit("test", "same-client", 2);
const secondLimit = await consumeRateLimit("test", "same-client", 2);
const thirdLimit = await consumeRateLimit("test", "same-client", 2);
assert.equal(firstLimit.allowed, true);
assert.equal(secondLimit.allowed, true);
assert.equal(thirdLimit.allowed, false);

const tallyHash = `0x${"55".repeat(32)}`;
const tallyTranscript = JSON.stringify({ proposalId: 1, finalTally: [1, 0] });
assert.equal(await saveTallyTranscript(tallyHash, tallyTranscript), tallyTranscript);
assert.equal(await getTallyTranscript(tallyHash), tallyTranscript);
assert.equal(await saveTallyTranscript(tallyHash, "different"), tallyTranscript);
assert.equal(normalizeStoredTallyTranscript(JSON.parse(tallyTranscript)), tallyTranscript);
assert.equal(
  normalizeStoredTallyTranscript({ format: "cipherballot-tally-storage-v1", transcript: tallyTranscript }),
  tallyTranscript
);

const challenge = await createCommitteeChallenge({ proposalId: 1, address: request.agent, purpose: "readiness", message: "test" });
assert.equal((await consumeCommitteeChallenge(challenge.id)).message, "test");
assert.equal(await consumeCommitteeChallenge(challenge.id), null);

await saveCommitteeReadiness(1, request.agent, "2026-08-10T10:00:00.000Z");
assert.equal((await listCommitteeReadiness(1))[0].address, request.agent);
const handoffPackage = { version: "cipherballot-committee-handoff-v1", ciphertext: "encrypted" };
await saveCommitteeHandoff(1, handoffPackage, "0x3333333333333333333333333333333333333333");
assert.deepEqual((await getCommitteeHandoff(1)).package, handoffPackage);
await markCommitteeHandoffRetrieved(1, request.agent);
assert.equal((await listCommitteeHandoffRetrievals(1))[0].address, request.agent);
await deleteCommitteeHandoff(1);
assert.equal(await getCommitteeHandoff(1), null);

console.log(JSON.stringify({ result: "passed", relayJobId: id, idempotent: true, distributedLock: true, rateLimit: true, tallyStorage: true, committeeStorage: true }, null, 2));
