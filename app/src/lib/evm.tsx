import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, ContractTransactionReceipt, Interface, JsonRpcProvider, SigningKey, ZeroHash, getAddress, hexlify, id, isHexString, keccak256, randomBytes, toUtf8Bytes } from "ethers";
import { decryptBallotEnvelope, encryptedBallotProofHash, encryptBallotEnvelope } from "./ballotEncryption";
import { BOT_CHAIN, CONTRACT_ADDRESS, CONTRACT_DEPLOYMENT_BLOCK } from "./network";
import { proposalCode } from "./proposalCode";

export { BOT_CHAIN, CONTRACT_ADDRESS, CONTRACT_DEPLOYMENT_BLOCK } from "./network";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, listener: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
    };
  }
}

export const ALREADY_VOTED_MESSAGE = "This wallet has already voted on this proposal. A ballot submitted by an authorized agent also uses the voter's single vote.";

const CONTRACT_ERROR_MESSAGES: Record<string, string> = {
  "InvalidOptions()": "A proposal must contain between 2 and 8 valid options.",
  "InvalidTitle()": "The proposal title is empty or exceeds the contract limit.",
  "InvalidOptionText()": "A voting option is empty or exceeds the contract limit.",
  "DuplicateOption()": "Voting options must be unique.",
  "InvalidVotingWindow()": "The proposal voting window is invalid.",
  "ProposalNotFound()": "This proposal does not exist on the current CipherBallot contract.",
  "VotingNotStarted()": "Voting has not started for this proposal yet.",
  "VotingEnded()": "Voting has already ended for this proposal.",
  "VotingNotEnded()": "This action is available only after voting ends.",
  "AlreadyVoted()": ALREADY_VOTED_MESSAGE,
  "NoCommitment()": "No hidden vote commitment was found for this wallet.",
  "AlreadyRevealed()": "This vote has already been revealed.",
  "InvalidReveal()": "The reveal details do not match the original vote commitment.",
  "InvalidOption()": "The selected ballot option is invalid.",
  "AlreadyFinalized()": "This proposal has already been finalized.",
  "EmptyCommitment()": "The vote commitment cannot be empty.",
  "RevealPeriodActive()": "The reveal period is still active.",
  "AllowlistTooLarge()": "The voter allowlist exceeds the contract limit.",
  "InvalidAllowlist()": "The voter allowlist contains a zero or duplicate address.",
  "CommitteeTooLarge()": "The committee exceeds the contract limit.",
  "InvalidCommittee()": "Add at least two valid, unique committee members.",
  "InvalidThreshold()": "The approval threshold must fit the committee size.",
  "InvalidMode()": "This action is not supported by the proposal's privacy mode.",
  "EmptyPrivateBallot()": "The encrypted ballot cannot be empty.",
  "BallotTooLarge()": "The encrypted ballot exceeds the contract limit.",
  "InvalidBallotProof()": "The ballot proof does not bind this encrypted ballot.",
  "InvalidTallySecret()": "The committee tally secret is incorrect.",
  "NotCommitteeMember()": "This wallet is not a committee member for the proposal.",
  "AlreadyApproved()": "This committee wallet has already approved the tally.",
  "TallyMismatch()": "The tally does not match the committee's existing approval record.",
  "TallyExceedsVoteCount()": "The tally total cannot exceed the number of submitted ballots.",
  "InvalidTallyURI()": "Add a valid tally evidence URI within the contract limit.",
  "InvalidTallyProof()": "Add a non-zero 32-byte tally proof hash.",
  "CommitteeThresholdNotMet()": "More committee approvals are required before finalization.",
  "NotEligible()": "This wallet is not eligible to vote on the proposal.",
  "InvalidAgent()": "Choose a valid agent address different from the voter wallet.",
  "InvalidDelegationExpiry()": "Choose an agent authorization expiration in the future.",
  "AgentNotAuthorized()": "This agent is not authorized by the voter.",
  "AgentAuthorizationExpired()": "The agent authorization has expired.",
  "AgentProposalNotAuthorized()": "The agent authorization does not cover this proposal.",
  "AgentVoteExpired()": "The signed agent vote instruction has expired.",
  "InvalidAgentNonce()": "The agent vote nonce is stale. Refresh the authorization state and try again.",
  "InvalidAgentSignature()": "The agent vote signature is invalid.",
  "InvalidVoter()": "Choose a valid voter address.",
  "InvalidVoterNonce()": "The one-time voter signature is stale. Create a fresh signed vote.",
  "InvalidVoterSignature()": "The one-time voter signature is invalid.",
  "InvalidPublicAgentNonce()": "The public agent vote nonce is stale. Create a fresh signed vote.",
  "InvalidPublicAgentSignature()": "The public agent vote signature is invalid.",
  "ProposalNotPublic()": "An agent can vote as itself only on a public proposal.",
  "InvalidEncryptionPublicKey()": "Generate or enter a valid 65-byte election public key."
};

const CONTRACT_ERROR_BY_SELECTOR = new Map(
  Object.entries(CONTRACT_ERROR_MESSAGES).map(([signature, message]) => [id(signature).slice(0, 10).toLowerCase(), message])
);

export const CIPHERBALLOT_ABI = [
  ...Object.keys(CONTRACT_ERROR_MESSAGES).map((signature) => `error ${signature}`),
  "function proposalCount() view returns (uint256)",
  "function createProposal(string title,string[] options,uint64 startTime,uint64 endTime,address[] allowlist) returns (uint256)",
  "function createThresholdProposal(string title,string[] options,uint64 startTime,uint64 endTime,address[] allowlist,address[] committee,uint256 threshold,bytes encryptionPublicKey,bytes32 tallySecretCommitment) returns (uint256)",
  "function commitVote(uint256 proposalId,bytes32 commitment)",
  "function submitPrivateBallot(uint256 proposalId,bytes privateBallot,bytes32 ballotProofHash)",
  "function setAgentDelegation(address agent,uint64 expiresAt,uint256 proposalId)",
  "function revokeAgentDelegation(address agent)",
  "function getAgentDelegation(address voter,address agent) view returns (uint64 expiresAt,uint256 proposalId,bool active)",
  "function agentNonces(address voter,address agent) view returns (uint256)",
  "function voterBallotNonces(address voter) view returns (uint256)",
  "function publicAgentNonces(address agent) view returns (uint256)",
  "function submitPrivateBallotByAgent(uint256 proposalId,address voter,address agent,bytes privateBallot,bytes32 ballotProofHash,uint256 nonce,uint64 deadline,bytes signature)",
  "function submitPrivateBallotByVoterSignature(uint256 proposalId,address voter,bytes privateBallot,bytes32 ballotProofHash,uint256 nonce,uint64 deadline,bytes signature)",
  "function submitPublicAgentBallot(uint256 proposalId,address agent,bytes privateBallot,bytes32 ballotProofHash,uint256 nonce,uint64 deadline,bytes signature)",
  "function revealVote(uint256 proposalId,uint256 optionIndex,bytes32 secret)",
  "function finalizeProposal(uint256 proposalId)",
  "function approveThresholdTally(uint256 proposalId,uint256[] finalTally,string tallyURI,bytes32 tallyProofHash,string tallySecret)",
  "function makeCommitment(uint256 proposalId,address voter,uint256 optionIndex,bytes32 secret) pure returns (bytes32)",
  "function getProposal(uint256 proposalId) view returns (address creator,string title,string[] options,uint64 startTime,uint64 endTime,uint64 revealDeadline,bool allowlistEnabled,uint256 allowedVoterCount,bool finalized,uint256 voteCount,uint256 revealCount,uint256[] finalTally)",
  "function getCommitment(uint256 proposalId,address voter) view returns (bytes32 commitment,bool revealed)",
  "function getPrivateBallotHash(uint256 proposalId,address voter) view returns (bytes32)",
  "function getEncryptionPublicKey(uint256 proposalId) view returns (bytes)",
  "function getPrivacyConfig(uint256 proposalId) view returns (uint8 mode,bytes32 tallySecretCommitment,uint256 committeeMemberCount,uint256 threshold,uint256 tallyApprovalCount,bytes32 tallyHash,string tallyURI,bytes32 tallyProofHash)",
  "function isAllowed(uint256 proposalId,address voter) view returns (bool)",
  "function isCommitteeMember(uint256 proposalId,address member) view returns (bool)",
  "function hasApprovedTally(uint256 proposalId,address member) view returns (bool)",
  "event ProposalCreated(uint256 indexed proposalId,address indexed creator,string title,uint8 mode,uint64 startTime,uint64 endTime,uint64 revealDeadline,bool allowlistEnabled,uint256 allowedVoterCount)",
  "event VoteCommitted(uint256 indexed proposalId,address indexed voter,bytes32 commitment)",
  "event PrivateBallotSubmitted(uint256 indexed proposalId,address indexed voter,bytes32 privateBallotHash,bytes32 ballotProofHash)",
  "event AgentDelegationSet(address indexed voter,address indexed agent,uint64 expiresAt,uint256 indexed proposalId)",
  "event AgentDelegationRevoked(address indexed voter,address indexed agent)",
  "event AgentBallotSubmitted(uint256 indexed proposalId,address indexed voter,address indexed agent,uint256 nonce,address relayer)",
  "event VoterSignedBallotSubmitted(uint256 indexed proposalId,address indexed voter,uint256 nonce,address relayer)",
  "event PublicAgentBallotSubmitted(uint256 indexed proposalId,address indexed agent,uint256 nonce,address relayer)",
  "event VoteRevealed(uint256 indexed proposalId,address indexed voter,uint256 indexed optionIndex)",
  "event ProposalFinalized(uint256 indexed proposalId,uint256 revealCount)",
  "event ThresholdTallyApproved(uint256 indexed proposalId,address indexed committeeMember,bytes32 tallyHash,uint256 approvalCount,uint256 threshold)"
];

export type PrivacyMode = "CommitReveal" | "SecretSealed";
export type ProposalStatus = "Active" | "Upcoming" | "Reveal" | "Tallying" | "Finalized";

export type ProposalView = {
  id: number;
  address: string;
  creator: string;
  title: string;
  options: string[];
  privacyMode: PrivacyMode;
  startTs: number;
  endTs: number;
  revealDeadline: number;
  allowlistEnabled: boolean;
  allowedVoterCount: number;
  finalized: boolean;
  votesCast: number;
  revealCount: number;
  finalTally: number[];
  tallySecretCommitment: string;
  committeeMemberCount: number;
  threshold: number;
  tallyApprovalCount: number;
  tallyHash: string;
  tallyURI: string;
  tallyProofHash: string;
  encryptionPublicKey: string;
  status: ProposalStatus;
};

export type PendingReveal = {
  proposalId: number;
  optionIndex: number;
  secret: string;
};

export type AgentDelegationView = {
  expiresAt: number;
  proposalId: number;
  active: boolean;
  nonce: number;
};

export type PrivateAgentReceipt = {
  id: string;
  mode: "voter-signed";
  proposalId: number;
  proposalTitle: string;
  option: string;
  ballotProofHash: string;
  deadline: number;
  createdAt: string;
};

export type ProofStats = {
  contractAddress: string;
  chainId: number;
  latestBlock: number;
  proposalCount: number;
  thresholdProposalCount: number;
  totalCommitments: number;
  totalReveals: number;
  totalTallyApprovals: number;
  activeCount: number;
  revealCount: number;
  tallyingCount: number;
  finalizedCount: number;
};

export type TallyTranscriptBallot = {
  transactionHash: string;
  voter: string;
  privateBallotHash: string;
  ballotProofHash: string;
};

export type TallyTranscript = {
  version: "cipherballot-tally-transcript-v1";
  chainId: number;
  contractAddress: string;
  proposalId: number;
  title: string;
  options: string[];
  finalTally: number[];
  ballotCount: number;
  ballots: TallyTranscriptBallot[];
};

export type PreparedThresholdTally = {
  finalTally: bigint[];
  transcript: TallyTranscript;
  transcriptJson: string;
  transcriptHash: string;
  tallySecret: string;
};

type WalletContext = {
  account: string;
  chainId: number | null;
  connected: boolean;
  connecting: boolean;
  switchingNetwork: boolean;
  networkError: string;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToBotChain: () => Promise<boolean>;
  clearNetworkError: () => void;
  getSignerContract: () => Promise<Contract>;
};

const EvmWalletContext = createContext<WalletContext | null>(null);

function getReadonlyContract() {
  if (!CONTRACT_ADDRESS) return null;
  return new Contract(CONTRACT_ADDRESS, CIPHERBALLOT_ABI, new JsonRpcProvider(BOT_CHAIN.rpcUrl, BOT_CHAIN.chainId));
}

function getReadonlyProvider() {
  return new JsonRpcProvider(BOT_CHAIN.rpcUrl, BOT_CHAIN.chainId);
}

function deriveStatus(
  proposal: Pick<ProposalView, "startTs" | "endTs" | "finalized" | "privacyMode">,
  now: number
): ProposalStatus {
  if (proposal.finalized) return "Finalized";
  if (now < proposal.startTs) return "Upcoming";
  if (now <= proposal.endTs) return "Active";
  if (proposal.privacyMode === "SecretSealed") return "Tallying";
  return "Reveal";
}

function toNumber(value: bigint | number): number {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted) || converted < 0) throw new Error("Contract returned an unsafe numeric value.");
  return converted;
}

function decodePrivacyMode(mode: bigint | number): PrivacyMode {
  return Number(mode) === 1 ? "SecretSealed" : "CommitReveal";
}

function pendingKey(account: string) {
  return `cipherballot:pending-reveals:${account.toLowerCase()}`;
}

function walletErrorDetails(error: unknown) {
  const queue: unknown[] = [error];
  const visited = new Set<unknown>();
  const codes: number[] = [];
  const messages: string[] = [];
  const selectors: string[] = [];

  while (queue.length && visited.size < 12) {
    const value = queue.shift();
    if (typeof value === "string") {
      if (/^0x[0-9a-fA-F]{8,}$/.test(value)) selectors.push(value.slice(0, 10).toLowerCase());
      continue;
    }
    if (!value || typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);
    const record = value as Record<string, unknown>;
    const code = Number(record.code);
    if (Number.isFinite(code)) codes.push(code);
    for (const key of ["message", "shortMessage", "reason"]) {
      if (typeof record[key] === "string") messages.push(record[key]);
    }
    for (const key of ["data", "error", "cause", "originalError", "info", "revert"]) {
      if (record[key]) queue.push(record[key]);
    }
  }

  return { codes, messages, selectors };
}

function isUnknownChainError(error: unknown) {
  const { codes, messages } = walletErrorDetails(error);
  return codes.includes(4902) || messages.some((message) =>
    /unknown chain|unrecognized chain|chain.*not (?:added|configured)|network.*not (?:added|configured)/i.test(message)
  );
}

function readableWalletError(error: unknown, fallback: string) {
  const { codes, messages } = walletErrorDetails(error);
  if (codes.includes(4001)) return "Network request was rejected in your wallet.";
  return messages[0] || fallback;
}

export function friendlyEvmError(error: unknown, fallback: string) {
  const { codes, messages, selectors } = walletErrorDetails(error);
  for (const selector of selectors) {
    const friendly = CONTRACT_ERROR_BY_SELECTOR.get(selector);
    if (friendly) return friendly;
  }

  const combined = messages.join(" ");
  for (const [signature, friendly] of Object.entries(CONTRACT_ERROR_MESSAGES)) {
    if (combined.includes(signature.slice(0, -2))) return friendly;
  }
  if (codes.includes(4001) || /user rejected|action rejected/i.test(combined)) {
    return "The transaction was rejected in your wallet.";
  }
  if (/insufficient funds/i.test(combined)) return "This wallet does not have enough BOT to pay the transaction fee.";

  const readable = messages.find((message) =>
    message.length <= 240 && !/unknown custom error|estimateGas|CALL_EXCEPTION|missing revert data|could not coalesce error/i.test(message)
  );
  return readable || fallback;
}

export function shortAddress(address: string) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function explorerAddress(address: string) {
  return `${BOT_CHAIN.explorerUrl.replace(/\/$/, "")}/address/${address}`;
}

export function explorerTx(hash: string) {
  return `${BOT_CHAIN.explorerUrl.replace(/\/$/, "")}/tx/${hash}`;
}

export function formatDateTime(ts: number) {
  if (!ts) return "-";
  return new Date(ts * 1000).toLocaleString();
}

export function EvmWalletProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [switchingNetwork, setSwitchingNetwork] = useState(false);
  const [networkError, setNetworkError] = useState("");

  const refresh = useCallback(async () => {
    if (!window.ethereum) return;
    const accounts = (await window.ethereum.request({ method: "eth_accounts" })) as string[];
    const chain = (await window.ethereum.request({ method: "eth_chainId" })) as string;
    setAccount(accounts[0] ? getAddress(accounts[0]) : "");
    setChainId(Number.parseInt(chain, 16));
  }, []);

  useEffect(() => {
    void refresh();
    if (!window.ethereum?.on) return;

    const handleAccounts = (accounts: unknown) => {
      const [next] = accounts as string[];
      setAccount(next ? getAddress(next) : "");
    };
    const handleChain = (nextChainId: unknown) => {
      setChainId(Number.parseInt(String(nextChainId), 16));
    };

    window.ethereum.on("accountsChanged", handleAccounts);
    window.ethereum.on("chainChanged", handleChain);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", handleAccounts);
      window.ethereum?.removeListener?.("chainChanged", handleChain);
    };
  }, [refresh]);

  const switchToBotChain = useCallback(async () => {
    setNetworkError("");
    if (!window.ethereum) {
      setNetworkError("Install MetaMask or another EVM wallet to add BOT Chain Testnet.");
      return false;
    }

    setSwitchingNetwork(true);
    try {
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: BOT_CHAIN.chainHex }]
        });
      } catch (error) {
        if (!isUnknownChainError(error)) throw error;
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: BOT_CHAIN.chainHex,
              chainName: BOT_CHAIN.name,
              rpcUrls: [BOT_CHAIN.rpcUrl],
              nativeCurrency: BOT_CHAIN.nativeCurrency,
              blockExplorerUrls: [BOT_CHAIN.explorerUrl]
            }
          ]
        });
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: BOT_CHAIN.chainHex }]
        });
      }

      const activeChain = await window.ethereum.request({ method: "eth_chainId" }) as string;
      if (Number.parseInt(activeChain, 16) !== BOT_CHAIN.chainId) {
        throw new Error("Your wallet did not switch to BOT Chain Testnet. Please try again in the wallet network menu.");
      }
      await refresh();
      return true;
    } catch (error) {
      setNetworkError(readableWalletError(error, "Could not switch to BOT Chain Testnet."));
      return false;
    } finally {
      setSwitchingNetwork(false);
    }
  }, [refresh]);

  const connect = useCallback(async () => {
    if (!window.ethereum) throw new Error("Install MetaMask or another EVM wallet to continue.");
    setConnecting(true);
    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      await refresh();
    } finally {
      setConnecting(false);
    }
  }, [refresh]);

  const disconnect = useCallback(() => {
    setAccount("");
  }, []);

  const getSignerContract = useCallback(async () => {
    if (!CONTRACT_ADDRESS) throw new Error("Set VITE_CIPHERBALLOT_CONTRACT_ADDRESS before using the app.");
    if (!window.ethereum) throw new Error("Install an EVM wallet to continue.");
    const provider = new BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    return new Contract(CONTRACT_ADDRESS, CIPHERBALLOT_ABI, signer);
  }, []);

  const value = useMemo(
    () => ({
      account,
      chainId,
      connected: Boolean(account),
      connecting,
      switchingNetwork,
      networkError,
      connect,
      disconnect,
      switchToBotChain,
      clearNetworkError: () => setNetworkError(""),
      getSignerContract
    }),
    [account, chainId, connecting, switchingNetwork, networkError, connect, disconnect, switchToBotChain, getSignerContract]
  );

  return <EvmWalletContext.Provider value={value}>{children}</EvmWalletContext.Provider>;
}

export function useEvmWallet() {
  const ctx = useContext(EvmWalletContext);
  if (!ctx) throw new Error("useEvmWallet must be used inside EvmWalletProvider");
  return ctx;
}

export async function fetchProposals(): Promise<ProposalView[]> {
  const contract = getReadonlyContract();
  if (!contract) return [];

  const [proposalCount, latestBlock] = await Promise.all([
    contract.proposalCount(),
    getReadonlyProvider().getBlock("latest")
  ]);
  if (!latestBlock) throw new Error("Unable to read the latest BOT Chain block.");
  const count = toNumber(proposalCount);
  const rows: ProposalView[] = [];

  for (let id = 1; id <= count; id++) {
    const [
      creator,
      title,
      options,
      startTime,
      endTime,
      revealDeadline,
      allowlistEnabled,
      allowedVoterCount,
      finalized,
      voteCount,
      revealCount,
      finalTally
    ] =
      await contract.getProposal(id);
    const [
      mode,
      tallySecretCommitment,
      committeeMemberCount,
      threshold,
      tallyApprovalCount,
      tallyHash,
      tallyURI,
      tallyProofHash
    ] = await contract.getPrivacyConfig(id);
    let encryptionPublicKey = "0x";
    if (Number(mode) === 1) {
      try {
        encryptionPublicKey = await contract.getEncryptionPublicKey(id);
      } catch {
        // Existing V1 deployments do not expose an election public key.
      }
    }
    const proposal = {
      id,
      address: CONTRACT_ADDRESS,
      creator,
      title,
      options,
      privacyMode: decodePrivacyMode(mode),
      startTs: toNumber(startTime),
      endTs: toNumber(endTime),
      revealDeadline: toNumber(revealDeadline),
      allowlistEnabled,
      allowedVoterCount: toNumber(allowedVoterCount),
      finalized,
      votesCast: toNumber(voteCount),
      revealCount: toNumber(revealCount),
      finalTally: finalTally.map(toNumber),
      tallySecretCommitment,
      committeeMemberCount: toNumber(committeeMemberCount),
      threshold: toNumber(threshold),
      tallyApprovalCount: toNumber(tallyApprovalCount),
      tallyHash,
      tallyURI,
      tallyProofHash,
      encryptionPublicKey,
      status: "Active" as ProposalStatus
    };
    proposal.status = deriveStatus(proposal, latestBlock.timestamp);
    rows.push(proposal);
  }

  return rows.sort((a, b) => b.id - a.id);
}

export async function fetchProposal(id: number): Promise<ProposalView | null> {
  const rows = await fetchProposals();
  return rows.find((row) => row.id === id) ?? null;
}

type RecoveryKitInput = {
  electionPrivateKey: string;
  committeeTallySecret: string;
};

function normalizeRecoveryKit(value: unknown): RecoveryKitInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Recovery kit must contain a JSON object.");
  const kit = value as Record<string, unknown>;
  const electionPrivateKey = String(kit.electionPrivateKey || "").trim();
  const committeeTallySecret = String(kit.committeeTallySecret || "").trim();
  if (!isHexString(electionPrivateKey, 32)) throw new Error("Recovery kit does not contain a valid election private key.");
  if (!isHexString(committeeTallySecret, 32)) throw new Error("Recovery kit does not contain a valid committee tally secret.");
  if (kit.format !== "cipherballot-election-recovery-v1") throw new Error("This file is not a supported CipherBallot recovery kit.");
  return { electionPrivateKey, committeeTallySecret };
}

export async function prepareThresholdTally(proposal: ProposalView, recoveryKit: unknown): Promise<PreparedThresholdTally> {
  if (proposal.privacyMode !== "SecretSealed") throw new Error("This proposal does not use encrypted threshold tallying.");
  if (proposal.finalized) throw new Error("This proposal has already been finalized.");
  if (!CONTRACT_ADDRESS || !isHexString(proposal.encryptionPublicKey, 65)) {
    throw new Error("The configured contract does not expose a valid election public key.");
  }
  if (!Number.isSafeInteger(CONTRACT_DEPLOYMENT_BLOCK) || CONTRACT_DEPLOYMENT_BLOCK < 0) {
    throw new Error("The configured contract deployment block is invalid.");
  }

  const { electionPrivateKey, committeeTallySecret } = normalizeRecoveryKit(recoveryKit);
  let derivedPublicKey: string;
  try {
    derivedPublicKey = new SigningKey(electionPrivateKey).publicKey;
  } catch {
    throw new Error("Recovery kit election private key is invalid.");
  }
  if (derivedPublicKey.toLowerCase() !== proposal.encryptionPublicKey.toLowerCase()) {
    throw new Error("This recovery kit does not belong to the selected proposal.");
  }
  if (keccak256(toUtf8Bytes(committeeTallySecret)).toLowerCase() !== proposal.tallySecretCommitment.toLowerCase()) {
    throw new Error("Recovery kit tally secret does not match the proposal commitment.");
  }

  const provider = getReadonlyProvider();
  const latestBlock = await provider.getBlock("latest");
  if (!latestBlock) throw new Error("Unable to read the latest BOT Chain block.");
  if (latestBlock.timestamp <= proposal.endTs) {
    throw new Error(`Ballot recovery is locked until voting ends at ${formatDateTime(proposal.endTs)}.`);
  }

  const contract = getReadonlyContract();
  if (!contract) throw new Error("CipherBallot contract is not configured.");
  const events = await contract.queryFilter(
    contract.filters.PrivateBallotSubmitted(proposal.id),
    CONTRACT_DEPLOYMENT_BLOCK,
    latestBlock.number
  );
  if (events.length !== proposal.votesCast) {
    throw new Error(`Found ${events.length} ballot events, but the contract records ${proposal.votesCast}. Tally preparation stopped.`);
  }

  const iface = new Interface(CIPHERBALLOT_ABI);
  const allowedMethods = new Set([
    "submitPrivateBallot",
    "submitPrivateBallotByAgent",
    "submitPrivateBallotByVoterSignature",
    "submitPublicAgentBallot"
  ]);
  const sortedEvents = [...events].sort((left, right) =>
    left.blockNumber === right.blockNumber ? left.index - right.index : left.blockNumber - right.blockNumber
  );
  const finalTally = Array.from({ length: proposal.options.length }, () => 0);
  const ballots: TallyTranscriptBallot[] = [];
  const seenVoters = new Set<string>();

  for (const event of sortedEvents) {
    if (!("args" in event)) throw new Error(`Ballot event ${event.transactionHash} could not be decoded.`);
    const args = event.args as unknown as {
      voter: string;
      privateBallotHash: string;
      ballotProofHash: string;
    };
    const transaction = await provider.getTransaction(event.transactionHash);
    if (!transaction || !transaction.to || getAddress(transaction.to) !== getAddress(CONTRACT_ADDRESS)) {
      throw new Error(`Ballot transaction ${event.transactionHash} does not call the configured contract.`);
    }
    const parsed = iface.parseTransaction({ data: transaction.data, value: transaction.value });
    if (!parsed || !allowedMethods.has(parsed.name)) {
      throw new Error(`Ballot transaction ${event.transactionHash} uses an unexpected contract method.`);
    }

    const privateBallot = String(parsed.args.privateBallot);
    const submittedProofHash = String(parsed.args.ballotProofHash);
    const voter = getAddress(args.voter);
    if (seenVoters.has(voter)) throw new Error(`Duplicate ballot owner found in transaction ${event.transactionHash}.`);
    seenVoters.add(voter);
    if (keccak256(privateBallot).toLowerCase() !== String(args.privateBallotHash).toLowerCase()) {
      throw new Error(`Encrypted ballot hash mismatch in transaction ${event.transactionHash}.`);
    }
    if (submittedProofHash.toLowerCase() !== String(args.ballotProofHash).toLowerCase()) {
      throw new Error(`Ballot event proof mismatch in transaction ${event.transactionHash}.`);
    }
    if (encryptedBallotProofHash(privateBallot).toLowerCase() !== submittedProofHash.toLowerCase()) {
      throw new Error(`Encrypted ballot proof mismatch in transaction ${event.transactionHash}.`);
    }

    const ballot = await decryptBallotEnvelope({
      privateBallot,
      electionPrivateKey,
      proposalId: proposal.id,
      chainId: BOT_CHAIN.chainId,
      contractAddress: CONTRACT_ADDRESS
    });
    if (getAddress(ballot.voter) !== voter) throw new Error(`Decrypted voter mismatch in transaction ${event.transactionHash}.`);
    if (ballot.optionIndex >= finalTally.length) throw new Error(`Decrypted option is invalid in transaction ${event.transactionHash}.`);

    finalTally[ballot.optionIndex] += 1;
    ballots.push({
      transactionHash: event.transactionHash,
      voter,
      privateBallotHash: String(args.privateBallotHash),
      ballotProofHash: submittedProofHash
    });
  }

  const transcript: TallyTranscript = {
    version: "cipherballot-tally-transcript-v1",
    chainId: BOT_CHAIN.chainId,
    contractAddress: getAddress(CONTRACT_ADDRESS),
    proposalId: proposal.id,
    title: proposal.title,
    options: [...proposal.options],
    finalTally,
    ballotCount: ballots.length,
    ballots
  };
  const transcriptJson = JSON.stringify(transcript);
  return {
    finalTally: finalTally.map((value) => BigInt(value)),
    transcript,
    transcriptJson,
    transcriptHash: keccak256(toUtf8Bytes(transcriptJson)),
    tallySecret: committeeTallySecret
  };
}

export async function publishTallyTranscript(prepared: PreparedThresholdTally): Promise<string> {
  const response = await fetch("/api/v1/tallies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript: prepared.transcriptJson, transcriptHash: prepared.transcriptHash })
  });
  const payload = await response.json().catch(() => ({})) as { uri?: string; error?: string };
  if (!response.ok || !payload.uri) throw new Error(payload.error || "Unable to publish the tally transcript.");
  return payload.uri;
}

export async function fetchProofStats(): Promise<ProofStats> {
  const provider = getReadonlyProvider();
  const rows = await fetchProposals();
  return {
    contractAddress: CONTRACT_ADDRESS,
    chainId: BOT_CHAIN.chainId,
    latestBlock: await provider.getBlockNumber(),
    proposalCount: rows.length,
    thresholdProposalCount: rows.filter((item) => item.privacyMode === "SecretSealed").length,
    totalCommitments: rows.reduce((sum, item) => sum + item.votesCast, 0),
    totalReveals: rows.reduce((sum, item) => sum + item.revealCount, 0),
    totalTallyApprovals: rows.reduce((sum, item) => sum + item.tallyApprovalCount, 0),
    activeCount: rows.filter((item) => item.status === "Active").length,
    revealCount: rows.filter((item) => item.status === "Reveal").length,
    tallyingCount: rows.filter((item) => item.status === "Tallying").length,
    finalizedCount: rows.filter((item) => item.status === "Finalized").length
  };
}

export async function createProposal(
  contract: Contract,
  title: string,
  options: string[],
  startTs: number,
  endTs: number,
  allowlist: string[]
) {
  const tx = await contract.createProposal(title, options, startTs, endTs, allowlist);
  const receipt = await tx.wait();
  return createdProposalResult(contract, receipt, tx.hash);
}

function createdProposalResult(contract: Contract, receipt: ContractTransactionReceipt | null, fallbackHash: string) {
  let proposalId = 0;
  for (const log of receipt?.logs || []) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === "ProposalCreated") {
        proposalId = toNumber(parsed.args.proposalId);
        break;
      }
    } catch {
      // Ignore unrelated logs in the transaction receipt.
    }
  }
  if (!proposalId) throw new Error("Proposal transaction confirmed, but its proposal ID could not be read.");
  return { hash: receipt?.hash || fallbackHash, proposalId };
}

export async function createThresholdProposal(
  contract: Contract,
  title: string,
  options: string[],
  startTs: number,
  endTs: number,
  allowlist: string[],
  committee: string[],
  threshold: number,
  encryptionPublicKey: string,
  tallySecret: string
) {
  const tallySecretCommitment = keccak256(toUtf8Bytes(tallySecret));
  const tx = await contract.createThresholdProposal(
    title,
    options,
    startTs,
    endTs,
    allowlist,
    committee,
    threshold,
    encryptionPublicKey,
    tallySecretCommitment
  );
  const receipt = await tx.wait();
  return createdProposalResult(contract, receipt, tx.hash);
}

export async function checkEligibility(proposalId: number, account: string): Promise<boolean> {
  const contract = getReadonlyContract();
  if (!contract || !account) return true;
  return Boolean(await contract.isAllowed(proposalId, account));
}

export async function hasVoted(proposalId: number, account: string, privacyMode: PrivacyMode): Promise<boolean> {
  const contract = getReadonlyContract();
  if (!contract || !account) return false;
  if (privacyMode === "SecretSealed") {
    return String(await contract.getPrivateBallotHash(proposalId, account)).toLowerCase() !== ZeroHash;
  }
  const commitment = await contract.getCommitment(proposalId, account);
  return String(commitment.commitment ?? commitment[0]).toLowerCase() !== ZeroHash;
}

export async function commitVote(contract: Contract, account: string, proposalId: number, optionIndex: number) {
  const secret = hexlify(randomBytes(32));
  const contractCommitment = await contract.makeCommitment(proposalId, account, optionIndex, secret);
  const tx = await contract.commitVote(proposalId, contractCommitment);
  const receipt = await tx.wait();
  savePendingReveal(account, { proposalId, optionIndex, secret });
  return { txHash: receipt?.hash || tx.hash, commitment: contractCommitment as string };
}

export async function submitPrivateBallot(contract: Contract, account: string, proposal: ProposalView, optionIndex: number) {
  const { privateBallot, ballotProofHash } = await encryptBallotEnvelope({
    optionIndex,
    proposalId: proposal.id,
    voter: account,
    encryptionPublicKey: proposal.encryptionPublicKey,
    chainId: BOT_CHAIN.chainId,
    contractAddress: CONTRACT_ADDRESS
  });

  const tx = await contract.submitPrivateBallot(proposal.id, privateBallot, ballotProofHash);
  const receipt = await tx.wait();
  return { txHash: receipt?.hash || tx.hash, ballotProofHash };
}

export function createAgentProposalBrief(proposal: ProposalView, voter?: string) {
  return JSON.stringify({
    type: "cipherballot-agent-proposal",
    version: 1,
    chainId: String(BOT_CHAIN.chainId),
    contract: CONTRACT_ADDRESS,
    proposalId: String(proposal.id),
    proposalCode: proposalCode(proposal.id),
    ...(voter ? { voter: getAddress(voter) } : {})
  }, null, 2);
}

export async function createVoterSignedVotePacket(
  contract: Contract,
  account: string,
  proposal: ProposalView,
  optionIndex: number
) {
  if (proposal.privacyMode !== "SecretSealed") {
    throw new Error("One-time signed relay is available only for secret-sealed proposals.");
  }
  const voter = getAddress(account);
  const { privateBallot, privateBallotHash, ballotProofHash } = await encryptBallotEnvelope({
    optionIndex,
    proposalId: proposal.id,
    voter,
    encryptionPublicKey: proposal.encryptionPublicKey,
    chainId: BOT_CHAIN.chainId,
    contractAddress: CONTRACT_ADDRESS
  });
  const nonce = await contract.voterBallotNonces(voter);
  const latestBlock = await getReadonlyProvider().getBlock("latest");
  if (!latestBlock) throw new Error("Unable to read the latest BOT Chain block.");
  const deadline = BigInt(latestBlock.timestamp + 15 * 60);
  const signer = contract.runner as {
    signTypedData?: (domain: unknown, types: unknown, value: unknown) => Promise<string>;
  } | null;
  if (!signer?.signTypedData) throw new Error("The connected wallet does not support EIP-712 typed signatures.");
  const signature = await signer.signTypedData(
    {
      name: "CipherBallot",
      version: "2",
      chainId: BOT_CHAIN.chainId,
      verifyingContract: CONTRACT_ADDRESS
    },
    {
      VoterBallot: [
        { name: "voter", type: "address" },
        { name: "proposalId", type: "uint256" },
        { name: "privateBallotHash", type: "bytes32" },
        { name: "ballotProofHash", type: "bytes32" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint64" }
      ]
    },
    {
      voter,
      proposalId: proposal.id,
      privateBallotHash,
      ballotProofHash,
      nonce,
      deadline
    }
  );
  const relayRequest = {
    mode: "voter-signed",
    proposalId: String(proposal.id),
    voter,
    encryptedBallot: hexlify(privateBallot),
    ballotProofHash,
    nonce: nonce.toString(),
    deadline: deadline.toString(),
    signature
  };
  savePrivateAgentReceipt({
    id: `${proposal.id}:${nonce.toString()}:${ballotProofHash}`,
    mode: "voter-signed",
    proposalId: proposal.id,
    proposalTitle: proposal.title,
    option: proposal.options[optionIndex],
    ballotProofHash,
    deadline: Number(deadline),
    createdAt: new Date().toISOString()
  });
  return JSON.stringify({
    type: "cipherballot-signed-vote",
    version: 1,
    relayRequest
  }, null, 2);
}

export function getPrivateAgentReceipts(): PrivateAgentReceipt[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const rows = JSON.parse(localStorage.getItem("cipherballot:private-agent-receipts:v1") || "[]");
    return Array.isArray(rows) ? rows.slice(0, 20) : [];
  } catch {
    return [];
  }
}

function savePrivateAgentReceipt(receipt: PrivateAgentReceipt) {
  if (typeof localStorage === "undefined") return;
  const rows = getPrivateAgentReceipts().filter((item) => item.id !== receipt.id);
  localStorage.setItem("cipherballot:private-agent-receipts:v1", JSON.stringify([receipt, ...rows].slice(0, 20)));
}

export async function revealVote(contract: Contract, account: string, reveal: PendingReveal) {
  const tx = await contract.revealVote(reveal.proposalId, reveal.optionIndex, reveal.secret);
  const receipt = await tx.wait();
  removePendingReveal(account, reveal.proposalId);
  return receipt?.hash || tx.hash;
}

export async function finalizeProposal(contract: Contract, proposalId: number) {
  const tx = await contract.finalizeProposal(proposalId);
  const receipt = await tx.wait();
  return receipt?.hash || tx.hash;
}

export async function approveThresholdTally(
  contract: Contract,
  proposalId: number,
  finalTally: Array<number | bigint>,
  tallyURI: string,
  tallyProofHash: string,
  tallySecret: string
) {
  const tx = await contract.approveThresholdTally(proposalId, finalTally, tallyURI, tallyProofHash, tallySecret);
  const receipt = await tx.wait();
  return receipt?.hash || tx.hash;
}

export async function checkCommitteeStatus(proposalId: number, account: string) {
  const contract = getReadonlyContract();
  if (!contract || !account) return { isMember: false, hasApproved: false };
  const [isMember, hasApproved] = await Promise.all([
    contract.isCommitteeMember(proposalId, account),
    contract.hasApprovedTally(proposalId, account)
  ]);
  return { isMember: Boolean(isMember), hasApproved: Boolean(hasApproved) };
}

export async function fetchAgentDelegation(voter: string, agent: string): Promise<AgentDelegationView> {
  const contract = getReadonlyContract();
  if (!contract) throw new Error("Set VITE_CIPHERBALLOT_CONTRACT_ADDRESS before loading agent delegation.");
  const [delegation, nonce] = await Promise.all([
    contract.getAgentDelegation(voter, agent),
    contract.agentNonces(voter, agent)
  ]);
  return {
    expiresAt: toNumber(delegation.expiresAt),
    proposalId: toNumber(delegation.proposalId),
    active: Boolean(delegation.active),
    nonce: toNumber(nonce)
  };
}

export async function setAgentDelegation(
  contract: Contract,
  agent: string,
  expiresAt: number,
  proposalId: number
) {
  const tx = await contract.setAgentDelegation(getAddress(agent), expiresAt, proposalId);
  const receipt = await tx.wait();
  return receipt?.hash || tx.hash;
}

export async function revokeAgentDelegation(contract: Contract, agent: string) {
  const tx = await contract.revokeAgentDelegation(getAddress(agent));
  const receipt = await tx.wait();
  return receipt?.hash || tx.hash;
}

export function getPendingReveals(account: string): PendingReveal[] {
  if (!account) return [];
  try {
    return JSON.parse(localStorage.getItem(pendingKey(account)) || "[]") as PendingReveal[];
  } catch {
    return [];
  }
}

export function normalizeAddressList(raw: string): string[] {
  const seen = new Set<string>();
  return raw
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => getAddress(item))
    .map((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) throw new Error(`Duplicate address: ${item}`);
      seen.add(key);
      return item;
    });
}

function savePendingReveal(account: string, reveal: PendingReveal) {
  const rows = getPendingReveals(account).filter((item) => item.proposalId !== reveal.proposalId);
  rows.push(reveal);
  localStorage.setItem(pendingKey(account), JSON.stringify(rows));
}

function removePendingReveal(account: string, proposalId: number) {
  const rows = getPendingReveals(account).filter((item) => item.proposalId !== proposalId);
  localStorage.setItem(pendingKey(account), JSON.stringify(rows));
}
