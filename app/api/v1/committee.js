import { randomBytes } from "node:crypto";
import { getAddress, isAddress, isHexString, verifyMessage } from "ethers";
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
  consumeCommitteeChallenge,
  consumeRateLimit,
  createCommitteeChallenge,
  deleteCommitteeHandoff,
  getCommitteeHandoff,
  listCommitteeHandoffRetrievals,
  listCommitteeReadiness,
  markCommitteeHandoffRetrieved,
  saveCommitteeHandoff,
  saveCommitteeReadiness
} from "../_lib/relay-store.js";

const MAX_BODY_BYTES = 96_000;
const HANDOFF_VERSION = "cipherballot-committee-handoff-v1";
const CHALLENGE_PURPOSES = new Set(["readiness", "release", "retrieve", "revoke"]);

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
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) throw new Error("Committee request exceeds the 96 KB limit.");
  const contentType = requestHeader(req, "content-type");
  if (contentType && !contentType.toLowerCase().startsWith("application/json")) throw new Error("Content-Type must be application/json.");
  const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) throw new Error("Committee request exceeds the 96 KB limit.");
  try {
    const parsed = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error("Request body must contain a JSON object.");
  }
}

function parseProposalId(value) {
  const proposalId = Number(value);
  if (!Number.isSafeInteger(proposalId) || proposalId < 1) throw new Error("A valid proposal ID is required.");
  return proposalId;
}

async function getProposalContext(proposalId) {
  const contract = getReadonlyContract();
  const [proposal, privacy, latestBlock] = await Promise.all([
    contract.getProposal(proposalId),
    contract.getPrivacyConfig(proposalId),
    getProvider().getBlock("latest")
  ]);
  if (!latestBlock) throw new Error("Unable to read the latest BOT Chain block.");
  if (Number(privacy.mode) !== 1) throw new Error("This proposal does not use a secret-sealed committee.");
  return { contract, proposal, privacy, latestBlock };
}

async function assertRole(context, proposalId, address, purpose) {
  const isCreator = getAddress(context.proposal.creator) === address;
  const isCommittee = Boolean(await context.contract.isCommitteeMember(proposalId, address));
  if ((purpose === "release" || purpose === "revoke") && !isCreator) {
    throw new Error("Only the proposal creator can manage the committee handoff.");
  }
  if ((purpose === "readiness" || purpose === "retrieve") && !isCommittee) {
    throw new Error("This wallet is not a committee member for the proposal.");
  }
  return { isCreator, isCommittee };
}

function challengeMessage({ purpose, proposalId, address, nonce, issuedAt, expiresAt }) {
  const audience = String(process.env.COMMITTEE_PORTAL_PUBLIC_URL || process.env.AGENT_RELAY_PUBLIC_URL || "https://www.cipherballot.xyz")
    .replace(/\/$/, "");
  return [
    "CipherBallot Committee Portal",
    "",
    `Audience: ${audience}`,
    `Action: ${purpose}`,
    `Chain ID: ${CHAIN_ID}`,
    `Contract: ${getAddress(CONTRACT_ADDRESS)}`,
    `Proposal ID: ${proposalId}`,
    `Wallet: ${address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expires At: ${expiresAt}`,
    "",
    "This signature does not authorize a transaction or transfer funds."
  ].join("\n");
}

async function createChallenge(rawBody) {
  const allowedFields = new Set(["action", "proposalId", "address", "purpose"]);
  if (Object.keys(rawBody).some((field) => !allowedFields.has(field))) throw new Error("Challenge request contains unknown fields.");
  const proposalId = parseProposalId(rawBody.proposalId);
  if (!isAddress(rawBody.address)) throw new Error("A valid wallet address is required.");
  const address = getAddress(rawBody.address);
  const purpose = String(rawBody.purpose || "");
  if (!CHALLENGE_PURPOSES.has(purpose)) throw new Error("Challenge purpose is invalid.");
  const context = await getProposalContext(proposalId);
  await assertRole(context, proposalId, address, purpose);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 5 * 60 * 1_000);
  const challenge = {
    purpose,
    proposalId,
    address,
    nonce: randomBytes(16).toString("hex"),
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString()
  };
  const message = challengeMessage(challenge);
  const stored = await createCommitteeChallenge({ ...challenge, message });
  return { challengeId: stored.id, message, expiresAt: challenge.expiresAt };
}

async function authenticate(rawBody, purpose) {
  if (typeof rawBody.challengeId !== "string" || typeof rawBody.signature !== "string") {
    throw new Error("A signed committee challenge is required.");
  }
  const challenge = await consumeCommitteeChallenge(rawBody.challengeId);
  if (!challenge || challenge.purpose !== purpose) throw new Error("The committee challenge is invalid or has already been used.");
  if (Date.parse(challenge.expiresAt) <= Date.now()) throw new Error("The committee challenge has expired.");
  if (!isHexString(rawBody.signature, 65)) throw new Error("The committee signature is invalid.");
  let signer;
  try {
    signer = getAddress(verifyMessage(challenge.message, rawBody.signature));
  } catch {
    throw new Error("The committee signature is invalid.");
  }
  if (signer !== getAddress(challenge.address)) throw new Error("The committee signature does not match the requested wallet.");
  const context = await getProposalContext(challenge.proposalId);
  await assertRole(context, challenge.proposalId, signer, purpose);
  return { challenge, context, signer };
}

export function validateHandoffPackage(value, proposalId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Encrypted handoff package is required.");
  const allowedFields = new Set(["version", "proposalId", "contractAddress", "chainId", "iv", "ciphertext", "keyCommitment"]);
  if (Object.keys(value).some((field) => !allowedFields.has(field))) throw new Error("Encrypted handoff package contains unknown fields.");
  if (value.version !== HANDOFF_VERSION || value.proposalId !== proposalId || value.chainId !== CHAIN_ID) {
    throw new Error("Encrypted handoff package context is invalid.");
  }
  if (!isAddress(value.contractAddress) || getAddress(value.contractAddress) !== getAddress(CONTRACT_ADDRESS)) {
    throw new Error("Encrypted handoff package contract is invalid.");
  }
  if (typeof value.iv !== "string" || !/^[A-Za-z0-9_-]{16}$/.test(value.iv)) throw new Error("Encrypted handoff IV is invalid.");
  if (typeof value.ciphertext !== "string" || value.ciphertext.length < 24 || value.ciphertext.length > 80_000
    || !/^[A-Za-z0-9_-]+$/.test(value.ciphertext)) {
    throw new Error("Encrypted handoff ciphertext is invalid.");
  }
  if (!isHexString(value.keyCommitment, 32)) throw new Error("Encrypted handoff key commitment is invalid.");
  return value;
}

async function publicStatus(proposalId) {
  await getProposalContext(proposalId);
  const [readiness, retrievals, handoff] = await Promise.all([
    listCommitteeReadiness(proposalId),
    listCommitteeHandoffRetrievals(proposalId),
    getCommitteeHandoff(proposalId)
  ]);
  return {
    proposalId,
    ready: readiness,
    retrieved: retrievals,
    handoff: handoff ? { available: true, releasedAt: handoff.releasedAt, expiresAt: handoff.expiresAt } : { available: false }
  };
}

export default async function handler(req, res) {
  const corsAllowed = setCors(req, res);
  if (req.method === "OPTIONS") return corsAllowed ? res.status(204).end() : sendJson(res, 403, { error: "Origin not allowed." });
  if (!corsAllowed) return sendJson(res, 403, { error: "Origin not allowed." });

  try {
    assertRelayStoreConfiguration();
    await assertRuntimeConfiguration();
    const rate = await consumeRateLimit("committee", clientAddress(req), 30, 60);
    res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfter));
      return sendJson(res, 429, { error: "Committee portal rate limit exceeded. Try again shortly." });
    }

    if (req.method === "GET") {
      return sendJson(res, 200, await publicStatus(parseProposalId(req.query.proposalId)));
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });

    const body = parseBody(req);
    const action = String(body.action || "");
    if (action === "challenge") return sendJson(res, 201, await createChallenge(body));

    if (action === "readiness") {
      const allowedFields = new Set(["action", "challengeId", "signature"]);
      if (Object.keys(body).some((field) => !allowedFields.has(field))) throw new Error("Readiness request contains unknown fields.");
      const { challenge, signer } = await authenticate(body, "readiness");
      const record = await saveCommitteeReadiness(challenge.proposalId, signer, new Date().toISOString());
      return sendJson(res, 200, record);
    }

    if (action === "release") {
      const allowedFields = new Set(["action", "challengeId", "signature", "package"]);
      if (Object.keys(body).some((field) => !allowedFields.has(field))) throw new Error("Handoff release contains unknown fields.");
      const { challenge, context, signer } = await authenticate(body, "release");
      if (context.latestBlock.timestamp <= Number(context.proposal.endTime)) {
        return sendJson(res, 409, { error: "The recovery package cannot be released until the on-chain voting deadline passes." });
      }
      if (context.proposal.finalized) return sendJson(res, 409, { error: "This proposal is already finalized." });
      const handoffPackage = validateHandoffPackage(body.package, challenge.proposalId);
      const stored = await saveCommitteeHandoff(challenge.proposalId, handoffPackage, signer);
      return sendJson(res, 201, { releasedAt: stored.releasedAt, expiresAt: stored.expiresAt });
    }

    if (action === "retrieve") {
      const allowedFields = new Set(["action", "challengeId", "signature"]);
      if (Object.keys(body).some((field) => !allowedFields.has(field))) throw new Error("Handoff retrieval contains unknown fields.");
      const { challenge, signer } = await authenticate(body, "retrieve");
      const handoff = await getCommitteeHandoff(challenge.proposalId);
      if (!handoff) return sendJson(res, 404, { error: "The creator has not released the committee package yet." });
      await markCommitteeHandoffRetrieved(challenge.proposalId, signer);
      return sendJson(res, 200, { package: handoff.package, releasedAt: handoff.releasedAt, expiresAt: handoff.expiresAt });
    }

    if (action === "revoke") {
      const allowedFields = new Set(["action", "challengeId", "signature"]);
      if (Object.keys(body).some((field) => !allowedFields.has(field))) throw new Error("Handoff revocation contains unknown fields.");
      const { challenge } = await authenticate(body, "revoke");
      await deleteCommitteeHandoff(challenge.proposalId);
      return sendJson(res, 200, { revoked: true });
    }

    return sendJson(res, 400, { error: "Unsupported committee action." });
  } catch (error) {
    const message = String(error?.message || "Committee request failed.");
    const clientError = /invalid|required|unknown|limit|match|expired|used|committee|creator|secret-sealed|malformed|context/i.test(message);
    return sendJson(res, clientError ? 400 : 500, { error: clientError ? message : "Committee request failed." });
  }
}
