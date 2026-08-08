import assert from "node:assert/strict";

process.env.BOTCHAIN_CHAIN_ID = "968";
process.env.CIPHERBALLOT_CONTRACT_ADDRESS = "0x1111111111111111111111111111111111111111";
process.env.AGENT_RELAY_STORE = "memory";
delete process.env.VERCEL_ENV;

const {
  acquireRelayLock,
  consumeRateLimit,
  createRelayJob,
  getRelayJob,
  isRelayJobId,
  releaseRelayLock,
  relayJobId,
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

console.log(JSON.stringify({ result: "passed", relayJobId: id, idempotent: true, distributedLock: true, rateLimit: true }, null, 2));
