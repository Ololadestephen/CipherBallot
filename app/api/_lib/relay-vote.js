import { getBytes, isAddress, isHexString, keccak256, zeroPadValue } from "ethers";
import { encryptedBallotProofHash, validateBallotEnvelope } from "../../examples/lib/ballot-envelope.mjs";
import {
  assertRuntimeConfiguration,
  errorMessage,
  getProvider,
  getReadonlyContract,
  getRelayerContract,
  isRelaySignerAllowed
} from "./cipherballot.js";

const ZERO_HASH = `0x${"0".repeat(64)}`;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const MAX_ENCRYPTED_BALLOT_BYTES = 4_096;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const VOTE_MODES = new Set(["delegated", "voter-signed", "public-agent"]);

export class RelayRequestError extends Error {
  constructor(message, status = 400, terminal = true) {
    super(message);
    this.status = status;
    this.terminal = terminal;
  }
}

function parseUnsignedInteger(value, name, maximum) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new RelayRequestError(`${name} must be an unsigned decimal string.`);
  }
  const parsed = BigInt(value);
  if (parsed > maximum) throw new RelayRequestError(`${name} exceeds its supported range.`);
  return parsed;
}

export function normalizeRelayRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RelayRequestError("Request body must be a JSON object.");
  }
  const allowedFields = new Set([
    "mode", "proposalId", "voter", "agent", "encryptedBallot", "ballotProofHash", "nonce", "deadline", "signature"
  ]);
  const unknownField = Object.keys(body).find((field) => !allowedFields.has(field));
  if (unknownField) throw new RelayRequestError(`Unknown request field: ${unknownField}.`);

  const proposalId = parseUnsignedInteger(body.proposalId, "proposalId", UINT256_MAX);
  const nonce = parseUnsignedInteger(body.nonce, "nonce", UINT256_MAX);
  const deadline = parseUnsignedInteger(body.deadline, "deadline", UINT64_MAX);
  const mode = String(body.mode || "delegated");
  const voter = String(body.voter || "");
  const agent = String(body.agent || "");
  const encryptedBallot = String(body.encryptedBallot || "");
  const ballotProofHash = String(body.ballotProofHash || "");
  const signature = String(body.signature || "");

  if (proposalId <= 0n) throw new RelayRequestError("proposalId must be positive.");
  if (!VOTE_MODES.has(mode)) throw new RelayRequestError("mode must be delegated, voter-signed, or public-agent.");
  if (mode !== "public-agent" && (!isAddress(voter) || voter.toLowerCase() === ZERO_ADDRESS)) {
    throw new RelayRequestError("A valid non-zero voter address is required for this mode.");
  }
  if (mode !== "voter-signed" && (!isAddress(agent) || agent.toLowerCase() === ZERO_ADDRESS)) {
    throw new RelayRequestError("A valid non-zero agent address is required for this mode.");
  }
  if (mode === "delegated" && voter.toLowerCase() === agent.toLowerCase()) {
    throw new RelayRequestError("Delegated voter and agent addresses must be distinct.");
  }
  if (mode === "voter-signed" && body.agent !== undefined) {
    throw new RelayRequestError("agent is not accepted for voter-signed mode.");
  }
  if (mode === "public-agent" && body.voter !== undefined) {
    throw new RelayRequestError("voter is not accepted for public-agent mode because the agent owns the ballot.");
  }
  if (!isHexString(encryptedBallot) || encryptedBallot === "0x") {
    throw new RelayRequestError("encryptedBallot must be non-empty hex ciphertext.");
  }
  if (getBytes(encryptedBallot).length > MAX_ENCRYPTED_BALLOT_BYTES) {
    throw new RelayRequestError("encryptedBallot exceeds the 4 KB limit.", 413);
  }
  try {
    validateBallotEnvelope(encryptedBallot);
  } catch (error) {
    throw new RelayRequestError(errorMessage(error));
  }
  if (!isHexString(ballotProofHash, 32) || ballotProofHash === ZERO_HASH) {
    throw new RelayRequestError("ballotProofHash must be a non-zero bytes32 value.");
  }
  if (encryptedBallotProofHash(encryptedBallot) !== ballotProofHash.toLowerCase()) {
    throw new RelayRequestError("ballotProofHash does not match the encrypted ballot.");
  }
  if (!isHexString(signature, 65)) throw new RelayRequestError("signature must be a 65-byte EIP-712 signature.");

  return {
    mode,
    proposalId: proposalId.toString(),
    ...(mode !== "public-agent" ? { voter } : {}),
    ...(mode !== "voter-signed" ? { agent } : {}),
    encryptedBallot,
    ballotProofHash: zeroPadValue(ballotProofHash, 32),
    nonce: nonce.toString(),
    deadline: deadline.toString(),
    signature
  };
}

export function relayParticipants(request) {
  return {
    ballotOwner: request.mode === "public-agent" ? request.agent : request.voter,
    ballotSigner: request.mode === "voter-signed" ? request.voter : request.agent
  };
}

function contractCall(contract, request) {
  const proposalId = BigInt(request.proposalId);
  const nonce = BigInt(request.nonce);
  const deadline = BigInt(request.deadline);
  if (request.mode === "delegated") {
    return {
      method: contract.submitPrivateBallotByAgent,
      args: [proposalId, request.voter, request.agent, request.encryptedBallot, request.ballotProofHash, nonce, deadline, request.signature]
    };
  }
  if (request.mode === "voter-signed") {
    return {
      method: contract.submitPrivateBallotByVoterSignature,
      args: [proposalId, request.voter, request.encryptedBallot, request.ballotProofHash, nonce, deadline, request.signature]
    };
  }
  return {
    method: contract.submitPublicAgentBallot,
    args: [proposalId, request.agent, request.encryptedBallot, request.ballotProofHash, nonce, deadline, request.signature]
  };
}

export async function validateRelayState(request) {
  await assertRuntimeConfiguration();
  const proposalId = BigInt(request.proposalId);
  const nonce = BigInt(request.nonce);
  const deadline = BigInt(request.deadline);
  const { ballotOwner, ballotSigner } = relayParticipants(request);
  if (!isRelaySignerAllowed(ballotSigner)) {
    throw new RelayRequestError("This signer is not permitted to use the configured relayer.", 403);
  }
  const provider = getProvider();
  const readonlyContract = getReadonlyContract();
  const stateReads = request.mode === "delegated"
    ? [readonlyContract.getAgentDelegation(request.voter, request.agent), readonlyContract.agentNonces(request.voter, request.agent)]
    : request.mode === "voter-signed"
      ? [Promise.resolve(null), readonlyContract.voterBallotNonces(request.voter)]
      : [Promise.resolve(null), readonlyContract.publicAgentNonces(request.agent)];
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
  if (deadline <= chainTimestamp) throw new RelayRequestError("The signed vote deadline has expired.");
  if (deadline > chainTimestamp + maxDeadlineWindow) {
    throw new RelayRequestError("The signed vote deadline is too far in the future.");
  }
  if (request.mode === "delegated") {
    if (!delegation.active) throw new RelayRequestError("The agent is not authorized by this voter.", 403);
    if (BigInt(delegation.expiresAt) < chainTimestamp) throw new RelayRequestError("The agent delegation has expired.", 403);
    if (deadline > BigInt(delegation.expiresAt)) {
      throw new RelayRequestError("The signed vote deadline exceeds the agent authorization expiry.");
    }
    if (BigInt(delegation.proposalId) !== 0n && BigInt(delegation.proposalId) !== proposalId) {
      throw new RelayRequestError("The delegation does not permit this proposal.", 403);
    }
  }
  const expectedBallotHash = keccak256(request.encryptedBallot);
  if (String(existingBallotHash).toLowerCase() !== ZERO_HASH) {
    if (String(existingBallotHash).toLowerCase() === expectedBallotHash.toLowerCase()) {
      return { alreadyAccepted: true, ballotOwner, ballotSigner, expectedBallotHash };
    }
    throw new RelayRequestError("This ballot owner has already voted on the proposal.", 409);
  }
  if (BigInt(expectedNonce) !== nonce) {
    throw new RelayRequestError("Nonce mismatch.", 409);
  }
  return { alreadyAccepted: false, ballotOwner, ballotSigner, expectedBallotHash };
}

function configuredMaxGas() {
  const text = String(process.env.AGENT_RELAY_MAX_GAS || "500000");
  if (!/^[0-9]+$/.test(text)) throw new Error("Agent relayer gas limit is not configured correctly.");
  const value = BigInt(text);
  if (value < 100_000n || value > 2_000_000n) throw new Error("Agent relayer gas limit is not configured correctly.");
  return value;
}

export async function simulateRelayRequest(request) {
  const state = await validateRelayState(request);
  if (state.alreadyAccepted) return { ...state, estimatedGas: 0n };
  const call = contractCall(getRelayerContract(), request);
  try {
    await call.method.staticCall(...call.args);
    const estimatedGas = await call.method.estimateGas(...call.args);
    if (estimatedGas > configuredMaxGas()) {
      throw new RelayRequestError("The relay transaction exceeds the configured gas limit.", 422);
    }
    return { ...state, estimatedGas };
  } catch (error) {
    if (error instanceof RelayRequestError) throw error;
    if (error?.code === "CALL_EXCEPTION") throw new RelayRequestError("The signed ballot failed contract validation.");
    throw error;
  }
}

export async function submitRelayTransaction(request) {
  const simulation = await simulateRelayRequest(request);
  if (simulation.alreadyAccepted) return { alreadyAccepted: true, ...simulation };
  const call = contractCall(getRelayerContract(), request);
  const tx = await call.method(...call.args, { gasLimit: simulation.estimatedGas * 120n / 100n });
  return { alreadyAccepted: false, tx, ...simulation };
}
