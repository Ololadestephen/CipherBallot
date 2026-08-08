import { isHexString } from "ethers";
import {
  EXPLORER_URL,
  assertRuntimeConfiguration,
  errorMessage,
  getProvider,
  requireApiKey,
  sendJson,
  setCors
} from "../_lib/cipherballot.js";
import { enqueueRelayJob } from "../_lib/relay-queue.js";
import {
  assertRelayStoreConfiguration,
  consumeRateLimit,
  createRelayJob,
  getRelayJob,
  isLocalInlineRelay,
  isRelayJobId,
  relayJobId,
  saveRelayJob
} from "../_lib/relay-store.js";
import { processRelayJob, publicRelayJob } from "../_lib/relay-worker.js";
import {
  RelayRequestError,
  normalizeRelayRequest,
  relayParticipants,
  simulateRelayRequest
} from "../_lib/relay-vote.js";

const MAX_BODY_BYTES = 16_384;

function requestHeader(req, name) {
  const entry = Object.entries(req.headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  const value = entry?.[1];
  return Array.isArray(value) ? value[0] : String(value || "");
}

function parseBody(req) {
  const contentLength = Number.parseInt(requestHeader(req, "content-length") || "0", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new RelayRequestError("Request body exceeds the 16 KB limit.", 413);
  }
  const contentType = requestHeader(req, "content-type");
  if (contentType && !contentType.toLowerCase().startsWith("application/json")) {
    throw new RelayRequestError("Content-Type must be application/json.", 415);
  }
  const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    throw new RelayRequestError("Request body exceeds the 16 KB limit.", 413);
  }
  try {
    return typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch {
    throw new RelayRequestError("Request body must contain valid JSON.");
  }
}

function clientIdentity(req) {
  const forwardedFor = requestHeader(req, "x-forwarded-for").split(",")[0].trim();
  const address = forwardedFor || requestHeader(req, "x-real-ip") || req.socket?.remoteAddress || "unknown";
  return `${address}:${requestHeader(req, "x-api-key")}`;
}

function configuredLimit(name, fallback, maximum) {
  const parsed = Number.parseInt(String(process.env[name] || fallback), 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), maximum) : fallback;
}

async function enforceDistributedLimit(req, res) {
  const result = await consumeRateLimit(
    "api",
    clientIdentity(req),
    configuredLimit("AGENT_API_RATE_LIMIT_PER_MINUTE", 30, 600)
  );
  res.setHeader("X-RateLimit-Remaining", String(result.remaining));
  if (result.allowed) return true;
  res.setHeader("Retry-After", String(result.retryAfter));
  sendJson(res, 429, { error: "Agent API rate limit exceeded. Try again shortly." });
  return false;
}

function statusUrl(req, jobId) {
  const origin = String(process.env.AGENT_RELAY_PUBLIC_URL || "https://www.cipherballot.xyz").replace(/\/$/, "");
  return `${origin}/api/v1/votes?jobId=${jobId}`;
}

function configurationFailure(message) {
  return ["configured", "configuration", "chain ID", "deployed contract", "VITE_", "Redis REST", "QStash", "WORKER_URL"]
    .some((fragment) => message.includes(fragment));
}

export default async function handler(req, res) {
  const corsAllowed = setCors(req, res);
  if (req.method === "OPTIONS") return corsAllowed ? res.status(204).end() : sendJson(res, 403, { error: "Origin not allowed." });
  if (!corsAllowed) return sendJson(res, 403, { error: "Origin not allowed." });
  if (!requireApiKey(req, res)) return;

  try {
    assertRelayStoreConfiguration();
    if (!(await enforceDistributedLimit(req, res))) return;

    if (req.method === "GET") {
      const jobId = String(req.query.jobId || "");
      const txHash = String(req.query.txHash || "");
      if (jobId && txHash) return sendJson(res, 400, { error: "Use either jobId or txHash, not both." });
      if (jobId) {
        if (!isRelayJobId(jobId)) return sendJson(res, 400, { error: "A valid jobId query parameter is required." });
        const job = await getRelayJob(jobId);
        if (!job) return sendJson(res, 404, { error: "Relay job not found." });
        return sendJson(res, 200, publicRelayJob(job));
      }
      if (!isHexString(txHash, 32)) {
        return sendJson(res, 400, { error: "A valid jobId or txHash query parameter is required." });
      }
      await assertRuntimeConfiguration();
      const receipt = await getProvider().getTransactionReceipt(txHash);
      return sendJson(res, 200, {
        txHash,
        status: receipt ? (receipt.status === 1 ? "confirmed" : "reverted") : "pending",
        blockNumber: receipt?.blockNumber || null,
        explorerUrl: `${EXPLORER_URL}/tx/${txHash}`
      });
    }

    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });

    const request = normalizeRelayRequest(parseBody(req));
    const participants = relayParticipants(request);
    const knownJob = await getRelayJob(relayJobId(request));
    if (knownJob && !["enqueue_failed", "queueing"].includes(knownJob.status)) {
      return sendJson(res, knownJob.status === "failed" ? 409 : 202, {
        ...publicRelayJob(knownJob),
        statusUrl: statusUrl(req, knownJob.id)
      });
    }

    const simulation = await simulateRelayRequest(request);
    const signerLimit = await consumeRateLimit(
      "signer",
      participants.ballotSigner.toLowerCase(),
      configuredLimit("AGENT_SIGNER_RATE_LIMIT_PER_MINUTE", 10, 120)
    );
    if (!signerLimit.allowed) {
      res.setHeader("Retry-After", String(signerLimit.retryAfter));
      return sendJson(res, 429, { error: "This ballot signer has reached the relay rate limit." });
    }

    const created = await createRelayJob(request, participants);
    let job = created.job;
    if (simulation.alreadyAccepted) {
      job = await saveRelayJob({ ...job, status: "confirmed", error: null });
      return sendJson(res, 200, { ...publicRelayJob(job), statusUrl: statusUrl(req, job.id) });
    }

    if (isLocalInlineRelay()) {
      job = await processRelayJob(job.id);
      return sendJson(res, 202, { ...publicRelayJob(job), statusUrl: statusUrl(req, job.id) });
    }

    const queueingAge = Date.now() - Date.parse(job.updatedAt || job.createdAt);
    if (!created.created && job.status === "queueing" && queueingAge < 30_000) {
      return sendJson(res, 202, { ...publicRelayJob(job), statusUrl: statusUrl(req, job.id) });
    }
    try {
      const queued = await enqueueRelayJob(job.id);
      job = await saveRelayJob({
        ...job,
        status: "queued",
        qstashMessageId: queued.messageId || job.qstashMessageId,
        error: null
      });
      return sendJson(res, 202, { ...publicRelayJob(job), statusUrl: statusUrl(req, job.id) });
    } catch (error) {
      await saveRelayJob({ ...job, status: "enqueue_failed", error: "The relay queue is temporarily unavailable." });
      throw error;
    }
  } catch (error) {
    if (error instanceof RelayRequestError) return sendJson(res, error.status, { error: error.message });
    const message = errorMessage(error);
    if (configurationFailure(message)) return sendJson(res, 503, { error: "Agent relayer configuration is unavailable." });
    return sendJson(res, 500, { error: "Unable to process the relayed ballot." });
  }
}
