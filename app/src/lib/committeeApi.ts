import { BrowserProvider, getAddress } from "ethers";
import type { CommitteeHandoffPackage } from "./committeeHandoff";

export type CommitteePortalStatus = {
  proposalId: number;
  ready: Array<{ address: string; readyAt: string }>;
  retrieved: Array<{ address: string; retrievedAt: string }>;
  handoff: { available: boolean; releasedAt?: string; expiresAt?: string };
};

type CommitteePurpose = "readiness" | "release" | "retrieve" | "revoke";

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Committee portal request failed.");
  return payload;
}

async function signedChallenge(proposalId: number, address: string, purpose: CommitteePurpose) {
  if (!window.ethereum) throw new Error("Install an EVM wallet to continue.");
  const normalizedAddress = getAddress(address);
  const challenge = await parseResponse<{ challengeId: string; message: string }>(await fetch("/api/v1/committee", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "challenge", proposalId, address: normalizedAddress, purpose })
  }));
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  if (getAddress(await signer.getAddress()) !== normalizedAddress) throw new Error("The connected wallet changed before signing.");
  const signature = await signer.signMessage(challenge.message);
  return { challengeId: challenge.challengeId, signature };
}

export async function fetchCommitteePortalStatus(proposalId: number) {
  return parseResponse<CommitteePortalStatus>(await fetch(`/api/v1/committee?proposalId=${proposalId}`, {
    headers: { Accept: "application/json" }
  }));
}

export async function confirmCommitteeReadiness(proposalId: number, address: string) {
  const auth = await signedChallenge(proposalId, address, "readiness");
  return parseResponse<{ address: string; readyAt: string }>(await fetch("/api/v1/committee", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "readiness", ...auth })
  }));
}

export async function releaseCommitteeHandoff(
  proposalId: number,
  address: string,
  handoffPackage: CommitteeHandoffPackage
) {
  const auth = await signedChallenge(proposalId, address, "release");
  return parseResponse<{ releasedAt: string; expiresAt: string }>(await fetch("/api/v1/committee", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "release", package: handoffPackage, ...auth })
  }));
}

export async function retrieveCommitteeHandoff(proposalId: number, address: string) {
  const auth = await signedChallenge(proposalId, address, "retrieve");
  return parseResponse<{ package: CommitteeHandoffPackage; releasedAt: string; expiresAt: string }>(await fetch("/api/v1/committee", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "retrieve", ...auth })
  }));
}

export async function revokeCommitteeHandoff(proposalId: number, address: string) {
  const auth = await signedChallenge(proposalId, address, "revoke");
  return parseResponse<{ revoked: boolean }>(await fetch("/api/v1/committee", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "revoke", ...auth })
  }));
}
