import {
  Contract,
  JsonRpcProvider,
  Wallet,
  getBytes,
  getAddress,
  isAddress,
  isHexString,
} from "ethers";
import { encryptBallot, encryptedBallotProofHash } from "./ballot-envelope.mjs";

export const PROPOSAL_BRIEF_TYPE = "cipherballot-agent-proposal";
export const SIGNED_VOTE_TYPE = "cipherballot-signed-vote";
export const PACKET_VERSION = 1;

const READ_ABI = [
  "function getProposal(uint256 proposalId) view returns (address creator,string title,string[] options,uint64 startTime,uint64 endTime,uint64 revealDeadline,bool allowlistEnabled,uint256 allowedVoterCount,bool finalized,uint256 voteCount,uint256 revealCount,uint256[] finalTally)",
  "function getPrivacyConfig(uint256 proposalId) view returns (uint8 mode,bytes32 tallySecretCommitment,uint256 committeeMemberCount,uint256 threshold,uint256 tallyApprovalCount,bytes32 tallyHash,string tallyURI,bytes32 tallyProofHash)",
  "function getEncryptionPublicKey(uint256 proposalId) view returns (bytes)",
  "function getPrivateBallotHash(uint256 proposalId,address voter) view returns (bytes32)",
  "function getAgentDelegation(address voter,address agent) view returns (uint64 expiresAt,uint256 proposalId,bool active)",
  "function agentNonces(address voter,address agent) view returns (uint256)",
  "function voterBallotNonces(address voter) view returns (uint256)",
  "function publicAgentNonces(address agent) view returns (uint256)"
];

export const BALLOT_TYPES = {
  delegated: {
    AgentBallot: [
      { name: "voter", type: "address" },
      { name: "agent", type: "address" },
      { name: "proposalId", type: "uint256" },
      { name: "privateBallotHash", type: "bytes32" },
      { name: "ballotProofHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint64" }
    ]
  },
  "voter-signed": {
    VoterBallot: [
      { name: "voter", type: "address" },
      { name: "proposalId", type: "uint256" },
      { name: "privateBallotHash", type: "bytes32" },
      { name: "ballotProofHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint64" }
    ]
  },
  "public-agent": {
    PublicAgentBallot: [
      { name: "agent", type: "address" },
      { name: "proposalId", type: "uint256" },
      { name: "privateBallotHash", type: "bytes32" },
      { name: "ballotProofHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint64" }
    ]
  }
};

function decimalString(value, name, { positive = false } = {}) {
  const text = String(value);
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error(`${name} must be an unsigned decimal value.`);
  if (positive && BigInt(text) === 0n) throw new Error(`${name} must be positive.`);
  return text;
}

function signedDecimalString(value, name, options) {
  if (typeof value !== "string") throw new Error(`${name} must be an unsigned decimal string.`);
  return decimalString(value, name, options);
}

function packetJson(input) {
  if (typeof input === "object" && input !== null) return input;
  const text = String(input || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (new TextEncoder().encode(text).length > 16_384) throw new Error("CipherBallot packets must not exceed 16 KB.");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The pasted CipherBallot packet is not valid JSON.");
  }
}

function normalizeAddress(value, name) {
  if (!isAddress(value)) throw new Error(`${name} is not a valid EVM address.`);
  return getAddress(value);
}

export function createProposalBrief({ chainId, contractAddress, proposalId, voter }) {
  const brief = {
    type: PROPOSAL_BRIEF_TYPE,
    version: PACKET_VERSION,
    chainId: decimalString(chainId, "chainId", { positive: true }),
    contract: normalizeAddress(contractAddress, "contract"),
    proposalId: decimalString(proposalId, "proposalId", { positive: true })
  };
  if (voter) brief.voter = normalizeAddress(voter, "voter");
  return brief;
}

export function parseProposalBrief(input) {
  const value = packetJson(input);
  if (value.type !== PROPOSAL_BRIEF_TYPE || value.version !== PACKET_VERSION) {
    throw new Error("Unsupported CipherBallot proposal brief.");
  }
  const allowed = new Set(["type", "version", "chainId", "contract", "proposalId", "voter"]);
  const unknown = Object.keys(value).find((field) => !allowed.has(field));
  if (unknown) throw new Error(`Unknown proposal brief field: ${unknown}.`);
  return createProposalBrief({
    chainId: value.chainId,
    contractAddress: value.contract,
    proposalId: value.proposalId,
    voter: value.voter
  });
}

export function createSignedVotePacket(relayRequest) {
  const mode = String(relayRequest.mode || "");
  if (!Object.hasOwn(BALLOT_TYPES, mode)) throw new Error("Unsupported signed vote mode.");
  const allowed = new Set([
    "mode", "proposalId", "voter", "agent", "encryptedBallot", "ballotProofHash", "nonce", "deadline", "signature"
  ]);
  const unknown = Object.keys(relayRequest).find((field) => !allowed.has(field));
  if (unknown) throw new Error(`Unknown signed vote field: ${unknown}.`);
  if (mode === "voter-signed" && relayRequest.agent !== undefined) {
    throw new Error("agent is not valid in a voter-signed packet.");
  }
  if (mode === "public-agent" && relayRequest.voter !== undefined) {
    throw new Error("voter is not valid in a public-agent packet.");
  }
  const proposalId = signedDecimalString(relayRequest.proposalId, "proposalId", { positive: true });
  const nonce = signedDecimalString(relayRequest.nonce, "nonce");
  const deadline = signedDecimalString(relayRequest.deadline, "deadline", { positive: true });
  if (!isHexString(relayRequest.encryptedBallot) || relayRequest.encryptedBallot === "0x") {
    throw new Error("Signed vote encryptedBallot must be non-empty hex.");
  }
  if (getBytes(relayRequest.encryptedBallot).length > 4_096) {
    throw new Error("Signed vote encryptedBallot must not exceed 4096 bytes.");
  }
  if (!isHexString(relayRequest.ballotProofHash, 32)) throw new Error("Signed vote ballotProofHash must be bytes32 hex.");
  if (encryptedBallotProofHash(relayRequest.encryptedBallot).toLowerCase() !== relayRequest.ballotProofHash.toLowerCase()) {
    throw new Error("Signed vote ballotProofHash does not bind the encrypted ballot.");
  }
  if (!isHexString(relayRequest.signature, 65)) throw new Error("Signed vote signature must be 65-byte hex.");
  const normalized = {
    mode,
    proposalId,
    ...(mode !== "public-agent" ? { voter: normalizeAddress(relayRequest.voter, "voter") } : {}),
    ...(mode !== "voter-signed" ? { agent: normalizeAddress(relayRequest.agent, "agent") } : {}),
    encryptedBallot: relayRequest.encryptedBallot,
    ballotProofHash: relayRequest.ballotProofHash,
    nonce,
    deadline,
    signature: relayRequest.signature
  };
  return { type: SIGNED_VOTE_TYPE, version: PACKET_VERSION, relayRequest: normalized };
}

export function parseSignedVotePacket(input) {
  const value = packetJson(input);
  if (value.type !== SIGNED_VOTE_TYPE || value.version !== PACKET_VERSION || !value.relayRequest) {
    throw new Error("Unsupported CipherBallot signed vote packet.");
  }
  return createSignedVotePacket(value.relayRequest);
}

export function createAgentRuntime(options = {}) {
  const chainId = Number(options.chainId ?? process.env.BOTCHAIN_CHAIN_ID ?? 968);
  const rpcUrl = options.rpcUrl ?? process.env.BOTCHAIN_RPC_URL ?? "https://rpc.bohr.life";
  const contractAddress = options.contractAddress ?? process.env.CIPHERBALLOT_CONTRACT_ADDRESS;
  const apiUrl = String(options.apiUrl ?? process.env.AGENT_API_URL ?? "").replace(/\/$/, "");
  const apiKey = options.apiKey ?? process.env.AGENT_API_KEY;
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("BOTCHAIN_CHAIN_ID must be a positive integer.");
  if (!contractAddress) throw new Error("Missing CIPHERBALLOT_CONTRACT_ADDRESS.");
  if (!apiUrl) throw new Error("Missing AGENT_API_URL.");
  if (!apiKey || String(apiKey).length < 32) throw new Error("AGENT_API_KEY must contain at least 32 characters.");
  let parsedApiUrl;
  try {
    parsedApiUrl = new URL(apiUrl);
  } catch {
    throw new Error("AGENT_API_URL must be an absolute URL.");
  }
  const localApi = parsedApiUrl.hostname === "localhost" || parsedApiUrl.hostname === "127.0.0.1";
  if (parsedApiUrl.protocol !== "https:" && !(localApi && parsedApiUrl.protocol === "http:")) {
    throw new Error("AGENT_API_URL must use HTTPS outside localhost.");
  }
  const normalizedContract = normalizeAddress(contractAddress, "CIPHERBALLOT_CONTRACT_ADDRESS");
  const provider = options.provider ?? new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
  return {
    chainId,
    rpcUrl,
    contractAddress: normalizedContract,
    apiUrl,
    apiKey,
    provider,
    contract: new Contract(normalizedContract, READ_ABI, provider)
  };
}

function apiHeaders(runtime, json = false) {
  return {
    ...(json ? { "content-type": "application/json" } : {}),
    "x-api-key": runtime.apiKey
  };
}

async function fetchWithTimeout(url, init = {}) {
  const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(10_000) });
  return response;
}

export async function fetchCanonicalProposal(runtime, proposalId) {
  const normalizedId = decimalString(proposalId, "proposalId", { positive: true });
  const response = await fetchWithTimeout(`${runtime.apiUrl}/api/v1/proposals?proposalId=${normalizedId}`, {
    headers: apiHeaders(runtime)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Proposal API returned ${response.status}.`);
  if (BigInt(payload.chainId) !== BigInt(runtime.chainId)) throw new Error("Proposal API returned an unexpected chain ID.");
  return payload.proposal;
}

function assertApiProposal(apiProposal, chainProposal) {
  const checks = [
    [String(apiProposal.id), String(chainProposal.id), "id"],
    [String(apiProposal.creator).toLowerCase(), chainProposal.creator.toLowerCase(), "creator"],
    [apiProposal.title, chainProposal.title, "title"],
    [JSON.stringify(apiProposal.options), JSON.stringify(chainProposal.options), "options"],
    [String(apiProposal.startTime), String(chainProposal.startTime), "start time"],
    [String(apiProposal.endTime), String(chainProposal.endTime), "end time"],
    [String(apiProposal.finalized), String(chainProposal.finalized), "finalized state"],
    [String(apiProposal.voteCount), String(chainProposal.voteCount), "vote count"],
    [apiProposal.privacyMode, chainProposal.privacyMode, "privacy mode"],
    [String(apiProposal.encryptionPublicKey).toLowerCase(), chainProposal.encryptionPublicKey.toLowerCase(), "election public key"],
    [String(apiProposal.acceptsAgentVotes), String(chainProposal.acceptsAgentVotes), "delegated voting state"],
    [String(apiProposal.acceptsVoterSignedVotes), String(chainProposal.acceptsVoterSignedVotes), "voter-signed state"],
    [String(apiProposal.acceptsPublicAgentVotes), String(chainProposal.acceptsPublicAgentVotes), "public-agent state"]
  ];
  const mismatch = checks.find(([apiValue, chainValue]) => apiValue !== chainValue);
  if (mismatch) throw new Error(`Proposal API ${mismatch[2]} does not match BOT Chain.`);
}

export async function inspectProposalBrief(runtime, input) {
  const brief = parseProposalBrief(input);
  if (BigInt(brief.chainId) !== BigInt(runtime.chainId)) throw new Error("Proposal brief chain does not match this agent runtime.");
  if (brief.contract.toLowerCase() !== runtime.contractAddress.toLowerCase()) {
    throw new Error("Proposal brief contract does not match this agent runtime.");
  }
  if (BigInt(brief.proposalId) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Proposal ID exceeds the agent client's safe range.");
  const [rpcChainId, bytecode, apiProposal, onchainProposal, privacy, latestBlock] = await Promise.all([
    runtime.provider.send("eth_chainId", []),
    runtime.provider.getCode(runtime.contractAddress),
    fetchCanonicalProposal(runtime, brief.proposalId),
    runtime.contract.getProposal(brief.proposalId),
    runtime.contract.getPrivacyConfig(brief.proposalId),
    runtime.provider.getBlock("latest")
  ]);
  if (BigInt(rpcChainId) !== BigInt(runtime.chainId)) throw new Error("RPC returned an unexpected chain ID.");
  if (bytecode === "0x") throw new Error("No contract is deployed at the configured address.");
  if (!latestBlock) throw new Error("Unable to read the latest BOT Chain block.");
  const secretSealed = Number(privacy.mode) === 1;
  const encryptionPublicKey = secretSealed
    ? await runtime.contract.getEncryptionPublicKey(brief.proposalId)
    : "0x";
  const active = !onchainProposal.finalized
    && latestBlock.timestamp >= Number(onchainProposal.startTime)
    && latestBlock.timestamp <= Number(onchainProposal.endTime);
  const proposal = {
    id: Number(brief.proposalId),
    creator: onchainProposal.creator,
    title: onchainProposal.title,
    options: Array.from(onchainProposal.options),
    startTime: Number(onchainProposal.startTime),
    endTime: Number(onchainProposal.endTime),
    finalized: onchainProposal.finalized,
    voteCount: Number(onchainProposal.voteCount),
    privacyMode: secretSealed ? "secret-sealed" : "commit-reveal",
    encryptionPublicKey,
    acceptsAgentVotes: secretSealed && active,
    acceptsVoterSignedVotes: secretSealed && active,
    acceptsPublicAgentVotes: secretSealed && !onchainProposal.allowlistEnabled && active
  };
  assertApiProposal(apiProposal, proposal);
  return { brief, proposal, chainTimestamp: latestBlock.timestamp };
}

function ballotDomain(runtime) {
  return {
    name: "CipherBallot",
    version: "2",
    chainId: runtime.chainId,
    verifyingContract: runtime.contractAddress
  };
}

function voteDeadline(seconds = 900, chainTimestamp) {
  const duration = Number(seconds);
  if (!Number.isSafeInteger(duration) || duration < 60 || duration > 3_600) {
    throw new Error("Vote signature duration must be between 60 and 3600 seconds.");
  }
  return BigInt(chainTimestamp + duration);
}

export async function prepareAgentVote(runtime, {
  mode,
  agentWallet,
  brief,
  optionIndex,
  voter,
  deadlineSeconds
}) {
  if (mode !== "delegated" && mode !== "public-agent") throw new Error("Agent mode must be delegated or public-agent.");
  if (!(agentWallet instanceof Wallet)) throw new Error("An ethers Wallet is required for agent signing.");
  const inspected = await inspectProposalBrief(runtime, brief);
  const proposal = inspected.proposal;
  const agent = agentWallet.address;
  const owner = mode === "public-agent" ? agent : normalizeAddress(voter || inspected.brief.voter, "voter");
  if (mode === "delegated" && !proposal.acceptsAgentVotes) throw new Error("This proposal is not accepting delegated agent votes.");
  if (mode === "public-agent" && !proposal.acceptsPublicAgentVotes) {
    throw new Error("This proposal does not allow public agents to vote as themselves.");
  }
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= proposal.options.length) {
    throw new Error("The selected option is outside the proposal ballot.");
  }

  const existing = await runtime.contract.getPrivateBallotHash(proposal.id, owner);
  if (String(existing).toLowerCase() !== `0x${"0".repeat(64)}`) throw new Error("This ballot owner has already voted on the proposal.");

  let nonce;
  if (mode === "delegated") {
    const [delegation, nextNonce] = await Promise.all([
      runtime.contract.getAgentDelegation(owner, agent),
      runtime.contract.agentNonces(owner, agent)
    ]);
    const now = BigInt(inspected.chainTimestamp);
    if (!delegation.active || BigInt(delegation.expiresAt) < now) throw new Error("The voter has no active delegation for this agent.");
    if (BigInt(delegation.proposalId) !== 0n && BigInt(delegation.proposalId) !== BigInt(proposal.id)) {
      throw new Error("The delegation does not cover this proposal.");
    }
    nonce = nextNonce;
  } else {
    nonce = await runtime.contract.publicAgentNonces(agent);
  }

  const encrypted = encryptBallot({
    optionIndex,
    proposalId: proposal.id,
    voter: owner,
    encryptionPublicKey: proposal.encryptionPublicKey,
    chainId: runtime.chainId,
    contractAddress: runtime.contractAddress
  });
  const deadline = voteDeadline(deadlineSeconds, inspected.chainTimestamp);
  const common = {
    proposalId: BigInt(proposal.id),
    privateBallotHash: encrypted.privateBallotHash,
    ballotProofHash: encrypted.ballotProofHash,
    nonce,
    deadline
  };
  const typedValue = mode === "delegated"
    ? { voter: owner, agent, ...common }
    : { agent, ...common };
  const signature = await agentWallet.signTypedData(ballotDomain(runtime), BALLOT_TYPES[mode], typedValue);
  const relayRequest = {
    mode,
    proposalId: String(proposal.id),
    ...(mode === "delegated" ? { voter: owner } : {}),
    agent,
    encryptedBallot: encrypted.privateBallot,
    ballotProofHash: encrypted.ballotProofHash,
    nonce: nonce.toString(),
    deadline: deadline.toString(),
    signature
  };
  return {
    proposal: { id: proposal.id, title: proposal.title, selectedOption: proposal.options[optionIndex] },
    ballotOwner: owner,
    relayRequest,
    privateReceipt: {
      type: "cipherballot-private-decision-receipt",
      version: PACKET_VERSION,
      mode,
      proposalId: String(proposal.id),
      ballotOwner: owner,
      optionIndex,
      option: proposal.options[optionIndex],
      ballotProofHash: encrypted.ballotProofHash,
      createdAt: new Date().toISOString()
    }
  };
}

export async function submitRelayRequest(runtime, relayRequest) {
  const response = await fetchWithTimeout(`${runtime.apiUrl}/api/v1/votes`, {
    method: "POST",
    headers: apiHeaders(runtime, true),
    body: JSON.stringify(relayRequest)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Vote API returned ${response.status}.`);
  return payload;
}

export async function submitSignedVotePacket(runtime, input) {
  return submitRelayRequest(runtime, parseSignedVotePacket(input).relayRequest);
}

export async function voteWithAgent(runtime, options) {
  const prepared = await prepareAgentVote(runtime, options);
  const relay = await submitRelayRequest(runtime, prepared.relayRequest);
  return { ...relay, proposal: prepared.proposal, privateReceipt: prepared.privateReceipt };
}

export async function readVoteStatus(runtime, txHash) {
  if (!isHexString(txHash, 32)) throw new Error("Transaction hash must be 32-byte hex.");
  const response = await fetchWithTimeout(`${runtime.apiUrl}/api/v1/votes?txHash=${txHash}`, {
    headers: apiHeaders(runtime)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Vote API returned ${response.status}.`);
  return payload;
}

export function agentWalletFromEnvironment(runtime) {
  if (!process.env.AGENT_PRIVATE_KEY) throw new Error("Missing AGENT_PRIVATE_KEY.");
  return new Wallet(process.env.AGENT_PRIVATE_KEY, runtime.provider);
}
