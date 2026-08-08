import {
  CHAIN_ID,
  CONTRACT_ADDRESS,
  assertRuntimeConfiguration,
  errorMessage,
  requireApiKey,
  sendJson,
  setCors
} from "../_lib/cipherballot.js";
import { getRelayQueueStatus } from "../_lib/relay-queue.js";
import { assertRelayStoreConfiguration, consumeRateLimit } from "../_lib/relay-store.js";

export default async function handler(req, res) {
  const corsAllowed = setCors(req, res);
  if (req.method === "OPTIONS") return corsAllowed ? res.status(204).end() : sendJson(res, 403, { error: "Origin not allowed." });
  if (!corsAllowed) return sendJson(res, 403, { error: "Origin not allowed." });
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
  if (!requireApiKey(req, res)) return;

  try {
    assertRelayStoreConfiguration();
    const redisCheck = await consumeRateLimit("health", "authenticated-health-check", 30);
    if (!redisCheck.allowed) return sendJson(res, 429, { error: "Health check rate limit exceeded." });
    const [, queue] = await Promise.all([assertRuntimeConfiguration(), getRelayQueueStatus()]);
    return sendJson(res, 200, {
      status: queue.parallelism === 1 && !queue.paused ? "ready" : "degraded",
      chainId: CHAIN_ID,
      contract: CONTRACT_ADDRESS,
      redis: "ready",
      queue
    });
  } catch (error) {
    const message = errorMessage(error);
    if (["configured", "configuration", "Redis REST", "QStash", "WORKER_URL", "chain ID", "deployed contract"]
      .some((fragment) => message.includes(fragment))) {
      return sendJson(res, 503, { error: "Agent relayer infrastructure is unavailable." });
    }
    return sendJson(res, 500, { error: "Unable to verify agent relayer health." });
  }
}
