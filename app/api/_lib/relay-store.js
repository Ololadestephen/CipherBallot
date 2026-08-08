import { createHash, randomBytes } from "node:crypto";
import { Redis } from "@upstash/redis";
import { CHAIN_ID, CONTRACT_ADDRESS } from "./cipherballot.js";

const JOB_TTL_SECONDS = 7 * 24 * 60 * 60;
const LOCK_TTL_SECONDS = 90;
const memoryValues = new Map();
let redis;

function localMemoryEnabled() {
  return process.env.AGENT_RELAY_STORE === "memory"
    && process.env.NODE_ENV !== "production"
    && !process.env.VERCEL_ENV;
}

function redisConfiguration() {
  return {
    url: String(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim(),
    token: String(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "").trim()
  };
}

function namespace() {
  return `cipherballot:${CHAIN_ID}:${CONTRACT_ADDRESS.toLowerCase()}`;
}

function storeKey(kind, id) {
  return `${namespace()}:${kind}:${id}`;
}

function memoryRead(key) {
  const item = memoryValues.get(key);
  if (!item) return null;
  if (item.expiresAt <= Date.now()) {
    memoryValues.delete(key);
    return null;
  }
  return item.value;
}

function memoryWrite(key, value, ttlSeconds, onlyIfMissing = false) {
  if (onlyIfMissing && memoryRead(key) !== null) return null;
  memoryValues.set(key, { value: structuredClone(value), expiresAt: Date.now() + ttlSeconds * 1_000 });
  return "OK";
}

export function assertRelayStoreConfiguration() {
  if (localMemoryEnabled()) return;
  const { url, token } = redisConfiguration();
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Redis REST storage is not configured correctly.");
  }
  if (parsed.protocol !== "https:" || token.length < 20) {
    throw new Error("Redis REST storage is not configured correctly.");
  }
}

function getRedis() {
  assertRelayStoreConfiguration();
  if (!redis) redis = new Redis(redisConfiguration());
  return redis;
}

function canonicalIntent(request) {
  return [
    CHAIN_ID,
    CONTRACT_ADDRESS.toLowerCase(),
    request.mode,
    request.proposalId,
    String(request.voter || "").toLowerCase(),
    String(request.agent || "").toLowerCase(),
    request.nonce,
    request.deadline,
    request.ballotProofHash.toLowerCase(),
    request.signature.toLowerCase()
  ].join(":");
}

export function relayJobId(request) {
  return `cb_${createHash("sha256").update(canonicalIntent(request)).digest("hex")}`;
}

export function isRelayJobId(value) {
  return /^cb_[0-9a-f]{64}$/.test(String(value || ""));
}

export async function createRelayJob(request, metadata = {}) {
  const jobId = relayJobId(request);
  const now = new Date().toISOString();
  const job = {
    id: jobId,
    status: "queueing",
    request,
    ballotOwner: metadata.ballotOwner,
    ballotSigner: metadata.ballotSigner,
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    qstashMessageId: null,
    txHash: null,
    blockNumber: null,
    error: null
  };
  const key = storeKey("job", jobId);
  if (localMemoryEnabled()) {
    const result = memoryWrite(key, job, JOB_TTL_SECONDS, true);
    return result ? { created: true, job } : { created: false, job: memoryRead(key) };
  }
  const result = await getRedis().set(key, job, { nx: true, ex: JOB_TTL_SECONDS });
  if (result) return { created: true, job };
  return { created: false, job: await getRedis().get(key) };
}

export async function getRelayJob(jobId) {
  if (!isRelayJobId(jobId)) return null;
  const key = storeKey("job", jobId);
  if (localMemoryEnabled()) return memoryRead(key);
  return getRedis().get(key);
}

export async function saveRelayJob(job) {
  const value = { ...job, updatedAt: new Date().toISOString() };
  const key = storeKey("job", value.id);
  if (localMemoryEnabled()) {
    memoryWrite(key, value, JOB_TTL_SECONDS);
    return value;
  }
  await getRedis().set(key, value, { ex: JOB_TTL_SECONDS });
  return value;
}

export async function acquireRelayLock(jobId) {
  const token = randomBytes(24).toString("hex");
  const key = storeKey("lock", jobId);
  if (localMemoryEnabled()) {
    const result = memoryWrite(key, token, LOCK_TTL_SECONDS, true);
    return result ? token : null;
  }
  const result = await getRedis().set(key, token, { nx: true, ex: LOCK_TTL_SECONDS });
  return result ? token : null;
}

export async function releaseRelayLock(jobId, token) {
  const key = storeKey("lock", jobId);
  if (localMemoryEnabled()) {
    if (memoryRead(key) === token) memoryValues.delete(key);
    return;
  }
  await getRedis().eval(
    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
    [key],
    [token]
  );
}

export async function consumeRateLimit(scope, identity, limit, windowSeconds = 60) {
  const boundedLimit = Math.min(Math.max(Number(limit) || 1, 1), 600);
  const digest = createHash("sha256").update(String(identity)).digest("hex");
  const windowId = Math.floor(Date.now() / (windowSeconds * 1_000));
  const key = storeKey(`rate:${scope}`, `${digest}:${windowId}`);
  if (localMemoryEnabled()) {
    const current = Number(memoryRead(key) || 0) + 1;
    memoryWrite(key, current, windowSeconds + 1);
    return { allowed: current <= boundedLimit, remaining: Math.max(0, boundedLimit - current), retryAfter: windowSeconds };
  }
  const [count, ttl] = await getRedis().eval(
    "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return {count, redis.call('TTL', KEYS[1])}",
    [key],
    [String(windowSeconds)]
  );
  const numericCount = Number(count);
  return {
    allowed: numericCount <= boundedLimit,
    remaining: Math.max(0, boundedLimit - numericCount),
    retryAfter: Math.max(1, Number(ttl) || windowSeconds)
  };
}

export function isLocalInlineRelay() {
  return localMemoryEnabled() && process.env.AGENT_RELAY_EXECUTION === "inline";
}
