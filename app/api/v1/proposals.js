import {
  CHAIN_ID,
  assertRuntimeConfiguration,
  errorMessage,
  getProvider,
  getReadonlyContract,
  requireApiKey,
  sendJson,
  setCors
} from "../_lib/cipherballot.js";
import { assertRelayStoreConfiguration, consumeRateLimit } from "../_lib/relay-store.js";

function requestHeader(req, name) {
  const entry = Object.entries(req.headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  const value = entry?.[1];
  return Array.isArray(value) ? value[0] : String(value || "");
}

async function enforceDistributedLimit(req, res) {
  assertRelayStoreConfiguration();
  const configured = Number.parseInt(String(process.env.AGENT_API_RATE_LIMIT_PER_MINUTE || "30"), 10);
  const limit = Number.isFinite(configured) ? Math.min(Math.max(configured, 1), 600) : 30;
  const forwardedFor = requestHeader(req, "x-forwarded-for").split(",")[0].trim();
  const address = forwardedFor || requestHeader(req, "x-real-ip") || req.socket?.remoteAddress || "unknown";
  const result = await consumeRateLimit("api", `${address}:${requestHeader(req, "x-api-key")}`, limit);
  res.setHeader("X-RateLimit-Remaining", String(result.remaining));
  if (result.allowed) return true;
  res.setHeader("Retry-After", String(result.retryAfter));
  sendJson(res, 429, { error: "Agent API rate limit exceeded. Try again shortly." });
  return false;
}

export default async function handler(req, res) {
  const corsAllowed = setCors(req, res);
  if (req.method === "OPTIONS") return corsAllowed ? res.status(204).end() : sendJson(res, 403, { error: "Origin not allowed." });
  if (!corsAllowed) return sendJson(res, 403, { error: "Origin not allowed." });
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
  if (!requireApiKey(req, res)) return;

  try {
    if (!(await enforceDistributedLimit(req, res))) return;
    await assertRuntimeConfiguration();
    const contract = getReadonlyContract();
    const [proposalCount, latestBlock] = await Promise.all([
      contract.proposalCount(),
      getProvider().getBlock("latest")
    ]);
    if (!latestBlock) throw new Error("Unable to read the latest BOT Chain block.");
    const count = Number(proposalCount);
    const proposalIdText = req.query.proposalId === undefined ? "" : String(req.query.proposalId);
    const requestedProposalId = proposalIdText === "" || !/^[1-9][0-9]*$/.test(proposalIdText)
      ? null
      : Number(proposalIdText);
    if (req.query.proposalId !== undefined && requestedProposalId === null) {
      return sendJson(res, 400, { error: "proposalId must be a positive decimal integer." });
    }
    if (requestedProposalId !== null && (!Number.isSafeInteger(requestedProposalId) || requestedProposalId < 1 || requestedProposalId > count)) {
      return sendJson(res, 400, { error: "proposalId must identify an existing proposal." });
    }
    const limitText = String(req.query.limit || "25");
    if (!/^[1-9][0-9]*$/.test(limitText)) return sendJson(res, 400, { error: "limit must be a positive decimal integer." });
    const requestedLimit = Number(limitText);
    const limit = Number.isSafeInteger(requestedLimit) ? Math.min(requestedLimit, 100) : 25;
    const firstId = requestedProposalId ?? Math.max(1, count - limit + 1);
    const lastId = requestedProposalId ?? count;
    const rows = [];

    for (let proposalId = lastId; proposalId >= firstId; proposalId--) {
      const [proposal, privacy] = await Promise.all([
        contract.getProposal(proposalId),
        contract.getPrivacyConfig(proposalId)
      ]);
      const isSecretSealed = Number(privacy.mode) === 1;
      const encryptionPublicKey = isSecretSealed ? await contract.getEncryptionPublicKey(proposalId) : "0x";
      const now = latestBlock.timestamp;
      rows.push({
        id: proposalId,
        creator: proposal.creator,
        title: proposal.title,
        options: proposal.options,
        startTime: Number(proposal.startTime),
        endTime: Number(proposal.endTime),
        finalized: proposal.finalized,
        voteCount: Number(proposal.voteCount),
        privacyMode: isSecretSealed ? "secret-sealed" : "commit-reveal",
        encryptionPublicKey,
        acceptsAgentVotes:
          isSecretSealed && !proposal.finalized && now >= Number(proposal.startTime) && now <= Number(proposal.endTime),
        acceptsVoterSignedVotes:
          isSecretSealed && !proposal.finalized && now >= Number(proposal.startTime) && now <= Number(proposal.endTime),
        acceptsPublicAgentVotes:
          isSecretSealed && !proposal.allowlistEnabled && !proposal.finalized && now >= Number(proposal.startTime) && now <= Number(proposal.endTime)
      });
    }

    return sendJson(res, 200, {
      chainId: CHAIN_ID,
      count,
      ...(requestedProposalId === null ? { proposals: rows } : { proposal: rows[0] })
    });
  } catch (error) {
    const message = errorMessage(error);
    if (message.includes("configured") || message.includes("chain ID") || message.includes("deployed contract") || message.includes("VITE_") || message.includes("Redis REST")) {
      return sendJson(res, 503, { error: "Agent API configuration is unavailable." });
    }
    return sendJson(res, 500, { error: "Unable to load proposals from BOT Chain." });
  }
}
