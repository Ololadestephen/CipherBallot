import { Client, Receiver } from "@upstash/qstash";

const DEFAULT_QUEUE_NAME = "cipherballot-relayer-v1";
let client;
let receiver;
let queueReady;

export function relayQueueName() {
  const value = String(process.env.QSTASH_QUEUE_NAME || DEFAULT_QUEUE_NAME).trim();
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(value)) throw new Error("QSTASH_QUEUE_NAME is not configured correctly.");
  return value;
}

export function relayWorkerUrl() {
  const value = String(process.env.AGENT_RELAY_WORKER_URL || "").trim();
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("AGENT_RELAY_WORKER_URL is not configured correctly.");
  }
  if (parsed.protocol !== "https:" || parsed.pathname !== "/api/internal/relay-worker" || parsed.search || parsed.hash) {
    throw new Error("AGENT_RELAY_WORKER_URL is not configured correctly.");
  }
  return parsed.toString();
}

export function assertRelayQueueConfiguration() {
  if (String(process.env.QSTASH_TOKEN || "").trim().length < 20) throw new Error("QStash is not configured correctly.");
  if (String(process.env.QSTASH_CURRENT_SIGNING_KEY || "").trim().length < 20) throw new Error("QStash is not configured correctly.");
  if (String(process.env.QSTASH_NEXT_SIGNING_KEY || "").trim().length < 20) throw new Error("QStash is not configured correctly.");
  relayQueueName();
  relayWorkerUrl();
}

function getClient() {
  assertRelayQueueConfiguration();
  if (!client) client = new Client({ token: process.env.QSTASH_TOKEN, enableTelemetry: false });
  return client;
}

function getReceiver() {
  assertRelayQueueConfiguration();
  if (!receiver) {
    receiver = new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
      devMode: false
    });
  }
  return receiver;
}

async function queue() {
  const activeQueue = getClient().queue({ queueName: relayQueueName() });
  if (!queueReady) queueReady = activeQueue.upsert({ parallelism: 1 }).catch((error) => {
    queueReady = undefined;
    throw error;
  });
  await queueReady;
  return activeQueue;
}

export async function enqueueRelayJob(jobId) {
  const activeQueue = await queue();
  return activeQueue.enqueueJSON({
    url: relayWorkerUrl(),
    body: { jobId },
    deduplicationId: jobId,
    retries: 3,
    timeout: "60s"
  });
}

export async function getRelayQueueStatus() {
  const activeQueue = await queue();
  const details = await activeQueue.get();
  return {
    name: details.name,
    parallelism: details.parallelism,
    paused: details.paused,
    lag: Math.max(0, Number(details.lag) || 0)
  };
}

export async function verifyQStashRequest(req, rawBody) {
  const signature = String(req.headers?.["upstash-signature"] || req.headers?.["Upstash-Signature"] || "");
  if (!signature) return false;
  try {
    return await getReceiver().verify({
      signature,
      body: rawBody,
      url: relayWorkerUrl(),
      upstashRegion: String(req.headers?.["upstash-region"] || "") || undefined,
      clockTolerance: 5
    });
  } catch {
    return false;
  }
}
