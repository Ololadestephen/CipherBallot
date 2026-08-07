import { getBytes, isAddress, isHexString, zeroPadValue } from "ethers";
import { encryptedBallotProofHash, validateBallotEnvelope } from "../../examples/lib/ballot-envelope.mjs";
import {
  EXPLORER_URL,
  assertRuntimeConfiguration,
  enforceRateLimit,
  enforceSignerRateLimit,
  errorMessage,
  getProvider,
  getReadonlyContract,
  getRelayerContract,
  isRelaySignerAllowed,
  releaseRelayIntent,
  requireApiKey,
  reserveRelayIntent,
  sendJson,
  setCors
} from "../_lib/cipherballot.js";

const ZERO_HASH = `0x${"0".repeat(64)}`;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const MAX_BODY_BYTES = 16_384;
const MAX_ENCRYPTED_BALLOT_BYTES = 4_096;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const VOTE_MODES = new Set(["delegated", "voter-signed", "public-agent"]);

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function requestHeader(req, name) {
  const entry = Object.entries(req.headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  const value = entry?.[1];
  return Array.isArray(value) ? value[0] : String(value || "");
}

function parseBody(req) {
  const contentLength = Number.parseInt(requestHeader(req, "content-length") || "0", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new RequestError("Request body exceeds the 16 KB limit.", 413);
  }

  const contentType = requestHeader(req, "content-type");
  if (contentType && !contentType.toLowerCase().startsWith("application/json")) {
    throw new RequestError("Content-Type must be application/json.", 415);
  }

  const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    throw new RequestError("Request body exceeds the 16 KB limit.", 413);
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch {
    throw new RequestError("Request body must contain valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError("Request body must be a JSON object.");
  }

  const allowedFields = new Set([
    "mode", "proposalId", "voter", "agent", "encryptedBallot", "ballotProofHash", "nonce", "deadline", "signature"
  ]);
  const unknownField = Object.keys(body).find((field) => !allowedFields.has(field));
  if (unknownField) throw new RequestError(`Unknown request field: ${unknownField}.`);
  return body;
}

function parseUnsignedInteger(value, name, maximum) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new RequestError(`${name} must be an unsigned decimal string.`);
  }
  const parsed = BigInt(value);
  if (parsed > maximum) throw new RequestError(`${name} exceeds its supported range.`);
  return parsed;
}

export default async function handler(req, res) {
  const corsAllowed = setCors(req, res);
  if (req.method === "OPTIONS") return corsAllowed ? res.status(204).end() : sendJson(res, 403, { error: "Origin not allowed." });
  if (!corsAllowed) return sendJson(res, 403, { error: "Origin not allowed." });
  if (!requireApiKey(req, res)) return;
  if (!enforceRateLimit(req, res)) return;

  if (req.method === "GET") {
    const txHash = String(req.query.txHash || "");
    if (!isHexString(txHash, 32)) return sendJson(res, 400, { error: "A valid txHash query parameter is required." });

    try {
      await assertRuntimeConfiguration();
      const receipt = await getProvider().getTransactionReceipt(txHash);
      return sendJson(res, 200, {
        txHash,
        status: receipt ? (receipt.status === 1 ? "confirmed" : "reverted") : "pending",
        blockNumber: receipt?.blockNumber || null,
        explorerUrl: `${EXPLORER_URL}/tx/${txHash}`
      });
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("configured") || message.includes("chain ID") || message.includes("deployed contract") || message.includes("VITE_")) {
        return sendJson(res, 503, { error: "Agent API configuration is unavailable." });
      }
      return sendJson(res, 500, { error: "Unable to read the transaction status." });
    }
  }

  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });

  let relayIntentKey = "";
  try {
    await assertRuntimeConfiguration();
    const body = parseBody(req);
    const proposalId = parseUnsignedInteger(body.proposalId, "proposalId", UINT256_MAX);
    const nonce = parseUnsignedInteger(body.nonce, "nonce", UINT256_MAX);
    const deadline = parseUnsignedInteger(body.deadline, "deadline", UINT64_MAX);
    const mode = String(body.mode || "delegated");
    const voter = String(body.voter || "");
    const agent = String(body.agent || "");
    const encryptedBallot = String(body.encryptedBallot || "");
    const ballotProofHash = String(body.ballotProofHash || "");
    const signature = String(body.signature || "");

    if (proposalId <= 0n) return sendJson(res, 400, { error: "proposalId must be positive." });
    if (!VOTE_MODES.has(mode)) return sendJson(res, 400, { error: "mode must be delegated, voter-signed, or public-agent." });
    if (mode !== "public-agent" && (!isAddress(voter) || voter.toLowerCase() === ZERO_ADDRESS)) {
      return sendJson(res, 400, { error: "A valid non-zero voter address is required for this mode." });
    }
    if (mode !== "voter-signed" && (!isAddress(agent) || agent.toLowerCase() === ZERO_ADDRESS)) {
      return sendJson(res, 400, { error: "A valid non-zero agent address is required for this mode." });
    }
    if (mode === "delegated" && voter.toLowerCase() === agent.toLowerCase()) {
      return sendJson(res, 400, { error: "Delegated voter and agent addresses must be distinct." });
    }
    if (mode === "voter-signed" && body.agent !== undefined) {
      return sendJson(res, 400, { error: "agent is not accepted for voter-signed mode." });
    }
    if (mode === "public-agent" && body.voter !== undefined) {
      return sendJson(res, 400, { error: "voter is not accepted for public-agent mode because the agent owns the ballot." });
    }
    if (!isHexString(encryptedBallot) || encryptedBallot === "0x") {
      return sendJson(res, 400, { error: "encryptedBallot must be non-empty hex ciphertext." });
    }
    if (getBytes(encryptedBallot).length > MAX_ENCRYPTED_BALLOT_BYTES) {
      return sendJson(res, 413, { error: "encryptedBallot exceeds the 4 KB limit." });
    }
    try {
      validateBallotEnvelope(encryptedBallot);
    } catch (error) {
      throw new RequestError(errorMessage(error));
    }
    if (!isHexString(ballotProofHash, 32) || ballotProofHash === ZERO_HASH) {
      return sendJson(res, 400, { error: "ballotProofHash must be a non-zero bytes32 value." });
    }
    if (encryptedBallotProofHash(encryptedBallot) !== ballotProofHash.toLowerCase()) {
      return sendJson(res, 400, { error: "ballotProofHash does not match the encrypted ballot." });
    }
    if (!isHexString(signature, 65)) return sendJson(res, 400, { error: "signature must be a 65-byte EIP-712 signature." });
    const ballotOwner = mode === "public-agent" ? agent : voter;
    const ballotSigner = mode === "voter-signed" ? voter : agent;
    if (!isRelaySignerAllowed(ballotSigner)) {
      return sendJson(res, 403, { error: "This signer is not permitted to use the configured relayer." });
    }
    const provider = getProvider();
    const readonlyContract = getReadonlyContract();
    const stateReads = mode === "delegated"
      ? [readonlyContract.getAgentDelegation(voter, agent), readonlyContract.agentNonces(voter, agent)]
      : mode === "voter-signed"
        ? [Promise.resolve(null), readonlyContract.voterBallotNonces(voter)]
        : [Promise.resolve(null), readonlyContract.publicAgentNonces(agent)];
    const [delegation, expectedNonce, existingBallotHash, latestBlock] = await Promise.all([
      stateReads[0],
      stateReads[1],
      readonlyContract.getPrivateBallotHash(proposalId, ballotOwner),
      provider.getBlock("latest")
    ]);
    if (!latestBlock) throw new Error("Unable to read the latest BOT Chain block.");
    const chainTimestamp = BigInt(latestBlock.timestamp);
    const configuredDeadlineWindow = Number.parseInt(String(process.env.AGENT_VOTE_MAX_DEADLINE_SECONDS || "3600"), 10);
    const maxDeadlineWindow = BigInt(Number.isFinite(configuredDeadlineWindow)
      ? Math.min(Math.max(configuredDeadlineWindow, 60), 86_400)
      : 3_600);
    if (deadline <= chainTimestamp) {
      return sendJson(res, 400, { error: "The signed vote deadline has expired." });
    }
    if (deadline > chainTimestamp + maxDeadlineWindow) {
      return sendJson(res, 400, { error: "The signed vote deadline is too far in the future." });
    }
    if (mode === "delegated") {
      if (!delegation.active) return sendJson(res, 403, { error: "The agent is not authorized by this voter." });
      if (BigInt(delegation.expiresAt) < chainTimestamp) {
        return sendJson(res, 403, { error: "The agent delegation has expired." });
      }
      if (deadline > BigInt(delegation.expiresAt)) {
        return sendJson(res, 400, { error: "The signed vote deadline exceeds the agent authorization expiry." });
      }
      if (BigInt(delegation.proposalId) !== 0n && BigInt(delegation.proposalId) !== proposalId) {
        return sendJson(res, 403, { error: "The delegation does not permit this proposal." });
      }
    }
    if (BigInt(expectedNonce) !== nonce) {
      return sendJson(res, 409, { error: "Nonce mismatch.", expectedNonce: expectedNonce.toString() });
    }
    if (String(existingBallotHash).toLowerCase() !== ZERO_HASH) {
      return sendJson(res, 409, { error: "This ballot owner has already voted on the proposal." });
    }

    relayIntentKey = mode === "delegated"
      ? `${mode}:${voter.toLowerCase()}:${agent.toLowerCase()}:${nonce}`
      : `${mode}:${ballotSigner.toLowerCase()}:${nonce}`;
    if (!reserveRelayIntent(relayIntentKey)) {
      return sendJson(res, 409, { error: "A ballot using this signer nonce is already being relayed." });
    }

    const contract = getRelayerContract();
    const normalizedProofHash = zeroPadValue(ballotProofHash, 32);
    let method;
    let args;
    if (mode === "delegated") {
      method = contract.submitPrivateBallotByAgent;
      args = [proposalId, voter, agent, encryptedBallot, normalizedProofHash, nonce, deadline, signature];
    } else if (mode === "voter-signed") {
      method = contract.submitPrivateBallotByVoterSignature;
      args = [proposalId, voter, encryptedBallot, normalizedProofHash, nonce, deadline, signature];
    } else {
      method = contract.submitPublicAgentBallot;
      args = [proposalId, agent, encryptedBallot, normalizedProofHash, nonce, deadline, signature];
    }
    await method.staticCall(...args);
    if (!enforceSignerRateLimit(ballotSigner, res)) {
      releaseRelayIntent(relayIntentKey);
      relayIntentKey = "";
      return;
    }
    const estimatedGas = await method.estimateGas(...args);
    const configuredMaxGasText = String(process.env.AGENT_RELAY_MAX_GAS || "500000");
    if (!/^[0-9]+$/.test(configuredMaxGasText)) throw new Error("Agent relayer gas limit is not configured correctly.");
    const configuredMaxGas = BigInt(configuredMaxGasText);
    if (configuredMaxGas < 100_000n || configuredMaxGas > 2_000_000n) {
      throw new Error("Agent relayer gas limit is not configured correctly.");
    }
    if (estimatedGas > configuredMaxGas) throw new RequestError("The relay transaction exceeds the configured gas limit.", 422);
    const tx = await method(...args, { gasLimit: estimatedGas * 120n / 100n });

    return sendJson(res, 202, {
      status: "submitted",
      mode,
      ballotOwner,
      txHash: tx.hash,
      explorerUrl: `${EXPLORER_URL}/tx/${tx.hash}`
    });
  } catch (error) {
    if (relayIntentKey) releaseRelayIntent(relayIntentKey);
    if (error instanceof RequestError) return sendJson(res, error.status, { error: error.message });
    const message = errorMessage(error);
    if (message.includes("configured") || message.includes("chain ID") || message.includes("deployed contract") || message.includes("VITE_")) {
      return sendJson(res, 503, { error: "Agent relayer configuration is unavailable." });
    }
    if (error?.code === "CALL_EXCEPTION") {
      return sendJson(res, 400, { error: "The signed ballot failed contract validation." });
    }
    return sendJson(res, 500, { error: "Unable to process the relayed ballot." });
  }
}
