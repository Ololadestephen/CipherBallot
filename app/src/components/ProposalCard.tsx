import { useMemo, useState } from "react";
import {
  BOT_CHAIN,
  checkEligibility,
  commitVote,
  explorerAddress,
  formatDateTime,
  getPendingReveals,
  revealVote,
  shortAddress,
  submitPrivateBallot,
  type ProposalView,
  useEvmWallet
} from "../lib/evm";

export function ProposalCard({
  proposal,
  onUpdate
}: {
  proposal: ProposalView;
  onUpdate?: () => void;
}) {
  const wallet = useEvmWallet();
  const [optionIndex, setOptionIndex] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const pendingReveal = useMemo(
    () => getPendingReveals(wallet.account).find((item) => item.proposalId === proposal.id),
    [wallet.account, proposal.id, status]
  );

  const handleVote = async () => {
    if (!wallet.connected) return setMessage("Connect wallet first");
    if (wallet.chainId !== BOT_CHAIN.chainId) return wallet.switchToBotChain();
    if (optionIndex === null) return setMessage("Select an option");

    try {
      setStatus("sending");
      if (!(await checkEligibility(proposal.id, wallet.account))) {
        setStatus("error");
        return setMessage("This proposal is allowlist-only, and your wallet is not eligible.");
      }
      setMessage(proposal.privacyMode === "SecretSealed" ? "Submitting private ballot..." : "Submitting hidden vote commitment...");
      const contract = await wallet.getSignerContract();
      const { txHash } = proposal.privacyMode === "SecretSealed"
        ? await submitPrivateBallot(contract, wallet.account, proposal, optionIndex)
        : await commitVote(contract, wallet.account, proposal.id, optionIndex);
      setStatus("done");
      setMessage(proposal.privacyMode === "SecretSealed" ? `Private ballot submitted: ${shortAddress(txHash)}` : `Vote committed: ${shortAddress(txHash)}`);
      onUpdate?.();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Vote submission failed");
    }
  };

  const handleReveal = async () => {
    if (!pendingReveal) return setMessage("No local reveal secret found for this proposal.");
    try {
      setStatus("sending");
      setMessage("Revealing vote after deadline...");
      const contract = await wallet.getSignerContract();
      const txHash = await revealVote(contract, wallet.account, pendingReveal);
      setStatus("done");
      setMessage(`Vote revealed: ${shortAddress(txHash)}`);
      onUpdate?.();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Reveal failed");
    }
  };

  const statusColor =
    proposal.status === "Active" ? "status-active" :
      proposal.status === "Finalized" ? "status-ended" : "status-upcoming";

  return (
    <div className="proposal-card">
      <div className="card-header">
        <div className="card-top">
          <span className={`pill ${statusColor} glass-panel`}>{proposal.status}</span>
          <span className="countdown">Proposal #{proposal.id}</span>
        </div>
        <h4 className="proposal-title">{proposal.title}</h4>
        <div className="card-meta" style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" }}>
          <span className="votes-count">
            {proposal.privacyMode === "SecretSealed"
              ? `${proposal.votesCast} private ballot${proposal.votesCast === 1 ? '' : 's'}`
              : proposal.finalized ? `${proposal.revealCount} revealed vote${proposal.revealCount === 1 ? '' : 's'}` : `${proposal.votesCast} hidden commitment${proposal.votesCast === 1 ? '' : 's'}`}
          </span>
          <span className="meta-separator" style={{ opacity: 0.3 }}>•</span>
          <span className="votes-count">
            {proposal.allowlistEnabled ? `${proposal.allowedVoterCount} eligible voter${proposal.allowedVoterCount === 1 ? '' : 's'}` : "Public vote"}
          </span>
          <span className="meta-separator" style={{ opacity: 0.3 }}>•</span>
          <span className="votes-count">
            {proposal.privacyMode === "SecretSealed" ? `${proposal.tallyApprovalCount}/${proposal.threshold} tally approval${proposal.tallyApprovalCount === 1 ? '' : 's'}` : "Commit-reveal"}
          </span>
          <span className="meta-separator" style={{ opacity: 0.3 }}>•</span>
          <a className="address-hash" href={explorerAddress(proposal.address)} target="_blank" rel="noreferrer" style={{ color: "var(--primary)", textDecoration: "none" }}>
            {shortAddress(proposal.address)}
          </a>
        </div>
        <p className="kpi" style={{ marginTop: "8px" }}>
          {proposal.privacyMode === "SecretSealed"
            ? `Voting ends ${formatDateTime(proposal.endTs)} · committee threshold ${proposal.threshold} of ${proposal.committeeMemberCount}`
            : `Voting ends ${formatDateTime(proposal.endTs)} · reveal deadline ${formatDateTime(proposal.revealDeadline)}`}
        </p>
      </div>

      <div className="card-content">
        <div className="options-vertical-stack" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {proposal.options.map((option, index) => (
            <button
              key={option}
              className={`option-tile ${optionIndex === index ? "selected" : ""}`}
              onClick={() => setOptionIndex(index)}
              disabled={proposal.status !== "Active" || (proposal.privacyMode === "CommitReveal" && Boolean(pendingReveal))}
              style={{
                display: "block",
                width: "100%",
                minHeight: "3.5rem",
                padding: "16px 20px",
                textAlign: "left",
                whiteSpace: "normal"
              }}
            >
              {option}
            </button>
          ))}
        </div>

        {proposal.status === "Active" && (
          <button
            className="cta full-width"
            onClick={handleVote}
            disabled={status === "sending" || (proposal.privacyMode === "CommitReveal" && Boolean(pendingReveal))}
            style={{ marginTop: "16px" }}
          >
            {proposal.privacyMode === "SecretSealed"
              ? status === "sending" ? "Submitting..." : "Submit Private Ballot"
              : pendingReveal ? "Hidden Vote Committed" : status === "sending" ? "Submitting..." : "Commit Hidden Vote"}
          </button>
        )}

        {proposal.privacyMode === "CommitReveal" && proposal.status === "Reveal" && (
          <button
            className="cta full-width"
            onClick={handleReveal}
            disabled={status === "sending" || !pendingReveal}
            style={{ marginTop: "16px" }}
          >
            {pendingReveal ? "Reveal My Vote" : "No Local Reveal Secret"}
          </button>
        )}

        {proposal.privacyMode === "SecretSealed" && proposal.status === "Tallying" && (
          <div className="pending-state-box" style={{ marginTop: "16px" }}>
            <strong>Committee Tally Window</strong>
            <p>{proposal.tallyApprovalCount} of {proposal.threshold} committee approvals are on-chain.</p>
          </div>
        )}

        {proposal.status === "Finalized" && (
          <div className="results-chart-section" style={{ marginTop: "16px" }}>
            {proposal.options.map((option, index) => (
              <div key={option} className="chart-row">
                <div className="chart-labels">
                  <span className="opt-name">{option}</span>
                  <span className="opt-val">{proposal.finalTally[index] || 0}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {message && (
          <p className={`feedback-msg ${status === "done" ? "done" : status === "error" ? "error" : ""}`}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
