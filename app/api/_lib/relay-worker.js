import { EXPLORER_URL, errorMessage, getProvider } from "./cipherballot.js";
import { RelayRequestError, submitRelayTransaction } from "./relay-vote.js";
import {
  acquireRelayLock,
  getRelayJob,
  releaseRelayLock,
  saveRelayJob
} from "./relay-store.js";

const TERMINAL_STATUSES = new Set(["confirmed", "failed"]);

export class RelayRetryError extends Error {}

export function publicRelayJob(job) {
  if (!job) return null;
  return {
    jobId: job.id,
    status: job.status,
    mode: job.request?.mode,
    ballotOwner: job.ballotOwner,
    attempts: job.attempts,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    txHash: job.txHash,
    blockNumber: job.blockNumber,
    explorerUrl: job.txHash ? `${EXPLORER_URL}/tx/${job.txHash}` : null,
    error: job.error
  };
}

async function reconcileSubmittedJob(job) {
  const receipt = await getProvider().getTransactionReceipt(job.txHash);
  if (!receipt) throw new RelayRetryError("The relay transaction is still pending.");
  if (receipt.status !== 1) {
    return saveRelayJob({ ...job, status: "failed", blockNumber: receipt.blockNumber, error: "The relay transaction reverted." });
  }
  return saveRelayJob({ ...job, status: "confirmed", blockNumber: receipt.blockNumber, error: null });
}

export async function processRelayJob(jobId) {
  let job = await getRelayJob(jobId);
  if (!job) throw new RelayRequestError("Relay job not found.", 404);
  if (TERMINAL_STATUSES.has(job.status)) return job;

  const lockToken = await acquireRelayLock(jobId);
  if (!lockToken) throw new RelayRetryError("Relay job is already being processed.");

  try {
    job = await getRelayJob(jobId);
    if (!job) throw new RelayRequestError("Relay job not found.", 404);
    if (TERMINAL_STATUSES.has(job.status)) return job;
    if (job.txHash) return reconcileSubmittedJob(job);

    job = await saveRelayJob({
      ...job,
      status: "processing",
      attempts: Number(job.attempts || 0) + 1,
      error: null
    });

    const submitted = await submitRelayTransaction(job.request);
    if (submitted.alreadyAccepted) {
      return saveRelayJob({ ...job, status: "confirmed", error: null });
    }

    job = await saveRelayJob({ ...job, status: "submitted", txHash: submitted.tx.hash, error: null });
    let receipt;
    try {
      receipt = await submitted.tx.wait(1, 45_000);
    } catch (error) {
      throw new RelayRetryError(errorMessage(error));
    }
    if (!receipt) throw new RelayRetryError("The relay transaction confirmation timed out.");
    if (receipt.status !== 1) {
      return saveRelayJob({ ...job, status: "failed", blockNumber: receipt.blockNumber, error: "The relay transaction reverted." });
    }
    return saveRelayJob({ ...job, status: "confirmed", blockNumber: receipt.blockNumber, error: null });
  } catch (error) {
    if (error instanceof RelayRequestError && error.terminal) {
      const current = await getRelayJob(jobId);
      if (!current) throw error;
      return saveRelayJob({ ...current, status: "failed", error: error.message });
    }
    if (error instanceof RelayRetryError) {
      const current = await getRelayJob(jobId);
      if (current && !current.txHash) await saveRelayJob({ ...current, status: "retrying", error: "Temporary relay failure; retry scheduled." });
      throw error;
    }
    const current = await getRelayJob(jobId);
    if (current && !current.txHash) await saveRelayJob({ ...current, status: "retrying", error: "Temporary relay failure; retry scheduled." });
    throw new RelayRetryError(errorMessage(error));
  } finally {
    await releaseRelayLock(jobId, lockToken);
  }
}
