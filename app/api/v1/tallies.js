import { getAddress, isAddress, isHexString, keccak256, toUtf8Bytes } from "ethers";
import {
  CHAIN_ID,
  CONTRACT_ADDRESS,
  assertRuntimeConfiguration,
  getProvider,
  getReadonlyContract,
  sendJson,
  setCors
} from "../_lib/cipherballot.js";
import {
  assertRelayStoreConfiguration,
  consumeRateLimit,
  getTallyTranscript,
  saveTallyTranscript
} from "../_lib/relay-store.js";

const MAX_BODY_BYTES = 262_144;
const MAX_BALLOTS = 2_000;

function requestHeader(req, name) {
  const entry = Object.entries(req.headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  const value = entry?.[1];
  return Array.isArray(value) ? value[0] : String(value || "");
}

function clientAddress(req) {
  return requestHeader(req, "x-forwarded-for").split(",")[0].trim()
    || requestHeader(req, "x-real-ip")
    || req.socket?.remoteAddress
    || "unknown";
}

function parseBody(req) {
  const contentLength = Number.parseInt(requestHeader(req, "content-length") || "0", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) throw new Error("Tally transcript exceeds the 256 KB limit.");
  const contentType = requestHeader(req, "content-type");
  if (contentType && !contentType.toLowerCase().startsWith("application/json")) throw new Error("Content-Type must be application/json.");
  const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) throw new Error("Tally transcript exceeds the 256 KB limit.");
  try {
    return typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch {
    throw new Error("Request body must contain valid JSON.");
  }
}

export function validateTallyTranscriptRequest(rawBody) {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) throw new Error("Request body must be an object.");
  const allowedBodyFields = new Set(["transcript", "transcriptHash"]);
  if (Object.keys(rawBody).some((field) => !allowedBodyFields.has(field))) throw new Error("Request contains unknown fields.");
  if (typeof rawBody.transcript !== "string" || Buffer.byteLength(rawBody.transcript, "utf8") > MAX_BODY_BYTES) {
    throw new Error("Tally transcript is missing or too large.");
  }
  if (!isHexString(rawBody.transcriptHash, 32) || /^0x0{64}$/i.test(rawBody.transcriptHash)) {
    throw new Error("Transcript hash must be non-zero 32-byte hex.");
  }
  if (keccak256(toUtf8Bytes(rawBody.transcript)) !== rawBody.transcriptHash.toLowerCase()) {
    throw new Error("Transcript content does not match its hash.");
  }

  let transcript;
  try {
    transcript = JSON.parse(rawBody.transcript);
  } catch {
    throw new Error("Transcript must contain valid JSON.");
  }
  if (!transcript || typeof transcript !== "object" || Array.isArray(transcript)) throw new Error("Transcript must contain a JSON object.");
  const allowedFields = new Set([
    "version", "chainId", "contractAddress", "proposalId", "title", "options", "finalTally", "ballotCount", "ballots"
  ]);
  if (Object.keys(transcript).some((field) => !allowedFields.has(field))) throw new Error("Transcript contains unknown fields.");
  if (transcript.version !== "cipherballot-tally-transcript-v1") throw new Error("Unsupported tally transcript version.");
  if (transcript.chainId !== CHAIN_ID) throw new Error("Transcript chain does not match BOT Chain.");
  if (!isAddress(transcript.contractAddress) || getAddress(transcript.contractAddress) !== getAddress(CONTRACT_ADDRESS)) {
    throw new Error("Transcript contract does not match the configured deployment.");
  }
  if (!Number.isSafeInteger(transcript.proposalId) || transcript.proposalId < 1) throw new Error("Transcript proposal ID is invalid.");
  if (typeof transcript.title !== "string" || transcript.title.length === 0 || transcript.title.length > 160) {
    throw new Error("Transcript title is invalid.");
  }
  if (!Array.isArray(transcript.options) || transcript.options.length < 2 || transcript.options.length > 8
    || transcript.options.some((option) => typeof option !== "string" || option.length === 0 || option.length > 96)) {
    throw new Error("Transcript options are invalid.");
  }
  if (!Array.isArray(transcript.finalTally) || transcript.finalTally.length !== transcript.options.length
    || transcript.finalTally.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("Transcript tally values are invalid.");
  }
  if (!Array.isArray(transcript.ballots) || transcript.ballots.length > MAX_BALLOTS
    || transcript.ballotCount !== transcript.ballots.length) {
    throw new Error("Transcript ballot records are invalid.");
  }
  if (transcript.finalTally.reduce((sum, value) => sum + value, 0) !== transcript.ballotCount) {
    throw new Error("Transcript tally total must equal its valid ballot count.");
  }
  const voters = new Set();
  const transactions = new Set();
  for (const ballot of transcript.ballots) {
    if (!ballot || typeof ballot !== "object" || Array.isArray(ballot)) throw new Error("Transcript contains an invalid ballot record.");
    const allowedBallotFields = new Set(["transactionHash", "voter", "privateBallotHash", "ballotProofHash"]);
    if (Object.keys(ballot).some((field) => !allowedBallotFields.has(field))) throw new Error("Transcript ballot contains unknown fields.");
    if (!isHexString(ballot.transactionHash, 32) || !isAddress(ballot.voter)
      || !isHexString(ballot.privateBallotHash, 32) || !isHexString(ballot.ballotProofHash, 32)) {
      throw new Error("Transcript ballot evidence is invalid.");
    }
    const voter = getAddress(ballot.voter).toLowerCase();
    const transactionHash = ballot.transactionHash.toLowerCase();
    if (voters.has(voter) || transactions.has(transactionHash)) throw new Error("Transcript contains duplicate ballot evidence.");
    voters.add(voter);
    transactions.add(transactionHash);
  }
  return { transcript, transcriptJson: rawBody.transcript, transcriptHash: rawBody.transcriptHash.toLowerCase() };
}

function publicUri(transcriptHash) {
  const origin = String(process.env.TALLY_PUBLIC_URL || process.env.AGENT_RELAY_PUBLIC_URL || "https://www.cipherballot.xyz").replace(/\/$/, "");
  return `${origin}/api/v1/tallies?hash=${transcriptHash}`;
}

export default async function handler(req, res) {
  const corsAllowed = setCors(req, res);
  if (req.method === "OPTIONS") return corsAllowed ? res.status(204).end() : sendJson(res, 403, { error: "Origin not allowed." });
  if (!corsAllowed) return sendJson(res, 403, { error: "Origin not allowed." });

  try {
    assertRelayStoreConfiguration();
    if (req.method === "GET") {
      const transcriptHash = String(req.query.hash || "").toLowerCase();
      if (!isHexString(transcriptHash, 32) || /^0x0{64}$/i.test(transcriptHash)) {
        return sendJson(res, 400, { error: "A valid transcript hash is required." });
      }
      const transcript = await getTallyTranscript(transcriptHash);
      if (!transcript) return sendJson(res, 404, { error: "Tally transcript not found." });
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return res.status(200).send(transcript);
    }

    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    const limit = await consumeRateLimit("tally-publish", clientAddress(req), 5, 60);
    res.setHeader("X-RateLimit-Remaining", String(limit.remaining));
    if (!limit.allowed) {
      res.setHeader("Retry-After", String(limit.retryAfter));
      return sendJson(res, 429, { error: "Tally publication rate limit exceeded. Try again shortly." });
    }

    await assertRuntimeConfiguration();
    const candidate = validateTallyTranscriptRequest(parseBody(req));
    const contract = getReadonlyContract();
    const [proposal, privacy, latestBlock] = await Promise.all([
      contract.getProposal(candidate.transcript.proposalId),
      contract.getPrivacyConfig(candidate.transcript.proposalId),
      getProvider().getBlock("latest")
    ]);
    if (!latestBlock || latestBlock.timestamp <= Number(proposal.endTime)) {
      return sendJson(res, 409, { error: "Tally publication is locked until the on-chain voting deadline passes." });
    }
    if (proposal.finalized) return sendJson(res, 409, { error: "This proposal is already finalized." });
    if (Number(privacy.mode) !== 1) return sendJson(res, 400, { error: "This proposal does not use secret-sealed tallying." });
    if (candidate.transcript.title !== proposal.title
      || JSON.stringify(candidate.transcript.options) !== JSON.stringify([...proposal.options])) {
      return sendJson(res, 400, { error: "Transcript proposal details do not match the contract." });
    }
    if (candidate.transcript.ballotCount !== Number(proposal.voteCount)) {
      return sendJson(res, 400, { error: "Transcript ballot count does not match the contract." });
    }

    const stored = await saveTallyTranscript(candidate.transcriptHash, candidate.transcriptJson);
    if (stored !== candidate.transcriptJson) {
      return sendJson(res, 409, { error: "A different transcript is already stored for this content hash." });
    }
    return sendJson(res, 201, {
      transcriptHash: candidate.transcriptHash,
      uri: publicUri(candidate.transcriptHash)
    });
  } catch (error) {
    const message = String(error?.message || "Unable to publish the tally transcript.");
    const clientError = /invalid|missing|unknown|match|limit|unsupported|required|duplicate|format|structure/i.test(message);
    return sendJson(res, clientError ? 400 : 500, { error: clientError ? message : "Unable to publish the tally transcript." });
  }
}
