import { isRelayJobId } from "../_lib/relay-store.js";
import { verifyQStashRequest } from "../_lib/relay-queue.js";
import { RelayRetryError, processRelayJob, publicRelayJob } from "../_lib/relay-worker.js";

export const config = { maxDuration: 60 };

function rawRequestBody(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  return JSON.stringify(req.body || {});
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const rawBody = rawRequestBody(req);
  if (!(await verifyQStashRequest(req, rawBody))) {
    return res.status(401).json({ error: "Invalid QStash signature." });
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: "Invalid queue message." });
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !isRelayJobId(body.jobId)) {
    return res.status(400).json({ error: "Invalid relay job identifier." });
  }

  try {
    const job = await processRelayJob(body.jobId);
    return res.status(200).json(publicRelayJob(job));
  } catch (error) {
    if (error instanceof RelayRetryError) {
      res.setHeader("Retry-After", "5");
      return res.status(503).json({ error: "Relay processing will be retried." });
    }
    return res.status(500).json({ error: "Unable to process relay job." });
  }
}
