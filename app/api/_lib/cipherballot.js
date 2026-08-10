import { timingSafeEqual } from "node:crypto";
import { Contract, JsonRpcProvider, NonceManager, Wallet, getAddress, isAddress, isHexString } from "ethers";

const configuredChainId = Number.parseInt(String(process.env.BOTCHAIN_CHAIN_ID || "968"), 10);
export const CHAIN_ID = configuredChainId;
export const RPC_URL = process.env.BOTCHAIN_RPC_URL || "https://rpc.bohr.life";
export const EXPLORER_URL = (process.env.BOTCHAIN_EXPLORER_URL || "https://scan.bohr.life").replace(/\/$/, "");
export const CONTRACT_ADDRESS = (
  process.env.CIPHERBALLOT_CONTRACT_ADDRESS || process.env.VITE_CIPHERBALLOT_CONTRACT_ADDRESS || ""
).trim();

let provider;
let readonlyContract;
let relayerContract;
let runtimeCheck;

export const ABI = [
  "function proposalCount() view returns (uint256)",
  "function getProposal(uint256 proposalId) view returns (address creator,string title,string[] options,uint64 startTime,uint64 endTime,uint64 revealDeadline,bool allowlistEnabled,uint256 allowedVoterCount,bool finalized,uint256 voteCount,uint256 revealCount,uint256[] finalTally)",
  "function getPrivacyConfig(uint256 proposalId) view returns (uint8 mode,bytes32 tallySecretCommitment,uint256 committeeMemberCount,uint256 threshold,uint256 tallyApprovalCount,bytes32 tallyHash,string tallyURI,bytes32 tallyProofHash)",
  "function getEncryptionPublicKey(uint256 proposalId) view returns (bytes)",
  "function isCommitteeMember(uint256 proposalId,address member) view returns (bool)",
  "function getAgentDelegation(address voter,address agent) view returns (uint64 expiresAt,uint256 proposalId,bool active)",
  "function agentNonces(address voter,address agent) view returns (uint256)",
  "function voterBallotNonces(address voter) view returns (uint256)",
  "function publicAgentNonces(address agent) view returns (uint256)",
  "function submitPrivateBallotByAgent(uint256 proposalId,address voter,address agent,bytes privateBallot,bytes32 ballotProofHash,uint256 nonce,uint64 deadline,bytes signature)",
  "function submitPrivateBallotByVoterSignature(uint256 proposalId,address voter,bytes privateBallot,bytes32 ballotProofHash,uint256 nonce,uint64 deadline,bytes signature)",
  "function submitPublicAgentBallot(uint256 proposalId,address agent,bytes privateBallot,bytes32 ballotProofHash,uint256 nonce,uint64 deadline,bytes signature)",
  "function getPrivateBallotHash(uint256 proposalId,address voter) view returns (bytes32)"
];

function headerValue(req, name) {
  const entry = Object.entries(req.headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  const value = entry?.[1];
  return Array.isArray(value) ? value[0] : String(value || "");
}

export function setCors(req, res) {
  const origin = headerValue(req, "origin");
  const host = headerValue(req, "x-forwarded-host") || headerValue(req, "host");
  const protocol = headerValue(req, "x-forwarded-proto") || "https";
  const sameOrigin = Boolean(origin && host && origin === `${protocol}://${host}`);
  const allowedOrigins = String(process.env.AGENT_API_ALLOWED_ORIGIN || "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const allowed = !origin || sameOrigin || allowedOrigins.includes(origin.replace(/\/$/, ""));

  res.setHeader("Vary", "Origin");
  if (origin && allowed) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-api-key");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return allowed;
}

export function sendJson(res, status, payload) {
  return res.status(status).json(payload);
}

export function requireApiKey(req, res) {
  const expected = String(process.env.AGENT_API_KEY || "").trim();
  if (expected.length < 32) {
    sendJson(res, 503, { error: "Agent API authentication is not securely configured." });
    return false;
  }

  const supplied = headerValue(req, "x-api-key");
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes)) return true;

  sendJson(res, 401, { error: "Invalid API key." });
  return false;
}

export function isRelaySignerAllowed(signer) {
  const configured = String(process.env.AGENT_API_ALLOWED_SIGNERS || "").trim();
  if (!configured) return true;
  const allowed = configured.split(",").map((value) => value.trim()).filter(Boolean);
  if (allowed.some((value) => !isAddress(value))) throw new Error("AGENT_API_ALLOWED_SIGNERS contains an invalid address.");
  const normalized = getAddress(signer).toLowerCase();
  return allowed.some((value) => getAddress(value).toLowerCase() === normalized);
}

export function getProvider() {
  if (!provider) provider = new JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
  return provider;
}

export async function assertRuntimeConfiguration() {
  const unsafePublicSecrets = ["VITE_RELAYER_PRIVATE_KEY", "VITE_AGENT_PRIVATE_KEY", "VITE_AGENT_API_KEY"]
    .filter((name) => process.env[name]);
  if (unsafePublicSecrets.length > 0) throw new Error("Server secrets must not use a VITE_ prefix.");
  if (!Number.isSafeInteger(CHAIN_ID) || CHAIN_ID <= 0) throw new Error("BOTCHAIN_CHAIN_ID is not configured correctly.");
  if (!isAddress(CONTRACT_ADDRESS)) throw new Error("CIPHERBALLOT_CONTRACT_ADDRESS is not configured correctly.");
  if (!runtimeCheck) {
    runtimeCheck = (async () => {
      const activeProvider = getProvider();
      const actualChainId = BigInt(await activeProvider.send("eth_chainId", []));
      if (actualChainId !== BigInt(CHAIN_ID)) throw new Error(`BOTCHAIN_RPC_URL must use chain ID ${CHAIN_ID}.`);
      if (await activeProvider.getCode(CONTRACT_ADDRESS) === "0x") {
        throw new Error("CIPHERBALLOT_CONTRACT_ADDRESS does not contain a deployed contract.");
      }
    })().catch((error) => {
      runtimeCheck = undefined;
      throw error;
    });
  }
  return runtimeCheck;
}

export function getReadonlyContract() {
  if (!isAddress(CONTRACT_ADDRESS)) throw new Error("CIPHERBALLOT_CONTRACT_ADDRESS is not configured correctly.");
  if (!readonlyContract) readonlyContract = new Contract(CONTRACT_ADDRESS, ABI, getProvider());
  return readonlyContract;
}

export function getRelayerContract() {
  const privateKey = String(process.env.RELAYER_PRIVATE_KEY || "").trim();
  if (!isHexString(privateKey, 32)) throw new Error("RELAYER_PRIVATE_KEY must be a 32-byte hex private key.");
  if (!isAddress(CONTRACT_ADDRESS)) throw new Error("CIPHERBALLOT_CONTRACT_ADDRESS is not configured correctly.");
  if (!relayerContract) {
    const wallet = new Wallet(privateKey, getProvider());
    const expectedAddress = String(process.env.RELAYER_EXPECTED_ADDRESS || "").trim();
    if (expectedAddress && (!isAddress(expectedAddress) || getAddress(expectedAddress) !== wallet.address)) {
      throw new Error("RELAYER_EXPECTED_ADDRESS does not match RELAYER_PRIVATE_KEY.");
    }
    relayerContract = new Contract(CONTRACT_ADDRESS, ABI, new NonceManager(wallet));
  }
  return relayerContract;
}

export function errorMessage(error) {
  return error?.shortMessage || error?.reason || error?.message || "Unexpected API error.";
}
