import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AbiCoder, BrowserProvider, Contract, JsonRpcProvider, getAddress, hexlify, keccak256, randomBytes, toUtf8Bytes } from "ethers";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, listener: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
    };
  }
}

export const BOT_CHAIN = {
  chainId: 968,
  chainHex: "0x3c8",
  name: "BOT Chain Testnet",
  rpcUrl: import.meta.env.VITE_BOTCHAIN_RPC_URL || "https://rpc.bohr.life",
  explorerUrl: import.meta.env.VITE_BOTCHAIN_EXPLORER_URL || "https://scan.bohr.life",
  nativeCurrency: {
    name: "BOT",
    symbol: "BOT",
    decimals: 18
  }
};

export const CONTRACT_ADDRESS = (import.meta.env.VITE_CIPHERBALLOT_CONTRACT_ADDRESS || "").trim();

export const CIPHERBALLOT_ABI = [
  "function proposalCount() view returns (uint256)",
  "function createProposal(string title,string[] options,uint64 startTime,uint64 endTime,address[] allowlist) returns (uint256)",
  "function createThresholdProposal(string title,string[] options,uint64 startTime,uint64 endTime,address[] allowlist,address[] committee,uint256 threshold,bytes32 tallySecretCommitment) returns (uint256)",
  "function commitVote(uint256 proposalId,bytes32 commitment)",
  "function submitPrivateBallot(uint256 proposalId,bytes privateBallot,bytes32 ballotProofHash)",
  "function revealVote(uint256 proposalId,uint256 optionIndex,bytes32 secret)",
  "function finalizeProposal(uint256 proposalId)",
  "function approveThresholdTally(uint256 proposalId,uint256[] finalTally,string tallyURI,bytes32 tallyProofHash,string tallySecret)",
  "function makeCommitment(uint256 proposalId,address voter,uint256 optionIndex,bytes32 secret) pure returns (bytes32)",
  "function getProposal(uint256 proposalId) view returns (address creator,string title,string[] options,uint64 startTime,uint64 endTime,uint64 revealDeadline,bool allowlistEnabled,uint256 allowedVoterCount,bool finalized,uint256 voteCount,uint256 revealCount,uint256[] finalTally)",
  "function getCommitment(uint256 proposalId,address voter) view returns (bytes32 commitment,bool revealed)",
  "function getPrivateBallotHash(uint256 proposalId,address voter) view returns (bytes32)",
  "function getPrivacyConfig(uint256 proposalId) view returns (uint8 mode,bytes32 tallySecretCommitment,uint256 committeeMemberCount,uint256 threshold,uint256 tallyApprovalCount,bytes32 tallyHash,string tallyURI,bytes32 tallyProofHash)",
  "function isAllowed(uint256 proposalId,address voter) view returns (bool)",
  "function isCommitteeMember(uint256 proposalId,address member) view returns (bool)",
  "function hasApprovedTally(uint256 proposalId,address member) view returns (bool)",
  "event ProposalCreated(uint256 indexed proposalId,address indexed creator,string title,uint8 mode,uint64 startTime,uint64 endTime,uint64 revealDeadline,bool allowlistEnabled,uint256 allowedVoterCount)",
  "event VoteCommitted(uint256 indexed proposalId,address indexed voter,bytes32 commitment)",
  "event PrivateBallotSubmitted(uint256 indexed proposalId,address indexed voter,bytes32 privateBallotHash,bytes32 ballotProofHash)",
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
  status: ProposalStatus;
};

export type PendingReveal = {
  proposalId: number;
  optionIndex: number;
  secret: string;
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

type WalletContext = {
  account: string;
  chainId: number | null;
  connected: boolean;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToBotChain: () => Promise<void>;
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

function deriveStatus(proposal: Pick<ProposalView, "startTs" | "endTs" | "finalized" | "privacyMode">): ProposalStatus {
  if (proposal.finalized) return "Finalized";
  const now = Math.floor(Date.now() / 1000);
  if (now < proposal.startTs) return "Upcoming";
  if (now <= proposal.endTs) return "Active";
  if (proposal.privacyMode === "SecretSealed") return "Tallying";
  return "Reveal";
}

function toNumber(value: bigint | number): number {
  return Number(value);
}

function decodePrivacyMode(mode: bigint | number): PrivacyMode {
  return Number(mode) === 1 ? "SecretSealed" : "CommitReveal";
}

function pendingKey(account: string) {
  return `cipherballot:pending-reveals:${account.toLowerCase()}`;
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
    if (!window.ethereum) throw new Error("Install an EVM wallet to continue.");
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BOT_CHAIN.chainHex }]
      });
    } catch (err: any) {
      if (err?.code !== 4902) throw err;
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
    }
    await refresh();
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
      connect,
      disconnect,
      switchToBotChain,
      getSignerContract
    }),
    [account, chainId, connecting, connect, disconnect, switchToBotChain, getSignerContract]
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

  const count = toNumber(await contract.proposalCount());
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
      status: "Active" as ProposalStatus
    };
    proposal.status = deriveStatus(proposal);
    rows.push(proposal);
  }

  return rows.sort((a, b) => b.id - a.id);
}

export async function fetchProposal(id: number): Promise<ProposalView | null> {
  const rows = await fetchProposals();
  return rows.find((row) => row.id === id) ?? null;
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
  return receipt?.hash || tx.hash;
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
    tallySecretCommitment
  );
  const receipt = await tx.wait();
  return receipt?.hash || tx.hash;
}

export async function checkEligibility(proposalId: number, account: string): Promise<boolean> {
  const contract = getReadonlyContract();
  if (!contract || !account) return true;
  return Boolean(await contract.isAllowed(proposalId, account));
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
  const salt = hexlify(randomBytes(32));
  const ballotProofHash = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "uint256", "bytes32", "bytes32"],
      [proposal.id, account, optionIndex, salt, proposal.tallySecretCommitment]
    )
  );
  const privateBallot = toUtf8Bytes(JSON.stringify({
    version: "cipherballot-secret-sealed-v1",
    proposalId: proposal.id,
    voter: account,
    secretCommitment: proposal.tallySecretCommitment,
    ballotProofHash,
    saltCommitment: keccak256(toUtf8Bytes(salt))
  }));

  const tx = await contract.submitPrivateBallot(proposal.id, privateBallot, ballotProofHash);
  const receipt = await tx.wait();
  return { txHash: receipt?.hash || tx.hash, ballotProofHash };
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
  finalTally: number[],
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
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
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
