import { Check, Copy, ShieldCheck } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import {
  ALREADY_VOTED_MESSAGE,
  BOT_CHAIN,
  checkEligibility,
  commitVote,
  createAgentProposalBrief,
  createVoterSignedVotePacket,
  explorerAddress,
  explorerTx,
  friendlyEvmError,
  formatDateTime,
  getPendingReveals,
  hasVoted,
  revealVote,
  shortAddress,
  submitPrivateBallot,
  type ProposalView,
  useEvmWallet,
} from "../lib/evm";

export function ProposalModal({
  proposal,
  onClose,
  onUpdate,
}: {
  proposal: ProposalView;
  onClose: () => void;
  onUpdate?: () => void;
}) {
  const wallet = useEvmWallet();
  const [optionIndex, setOptionIndex] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [txHash, setTxHash] = useState("");
  const [alreadyVoted, setAlreadyVoted] = useState(false);
  const [checkingVote, setCheckingVote] = useState(false);
  const [copiedBrief, setCopiedBrief] = useState(false);

  const pendingReveal = useMemo(
    () => getPendingReveals(wallet.account).find((item) => item.proposalId === proposal.id),
    [wallet.account, proposal.id, status]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;

    if (!wallet.connected || !wallet.account) {
      setAlreadyVoted(false);
      setCheckingVote(false);
      return;
    }

    setCheckingVote(true);
    void hasVoted(proposal.id, wallet.account, proposal.privacyMode)
      .then((voted) => {
        if (!cancelled) setAlreadyVoted(voted);
      })
      .catch(() => {
        if (!cancelled) setAlreadyVoted(false);
      })
      .finally(() => {
        if (!cancelled) setCheckingVote(false);
      });

    return () => {
      cancelled = true;
    };
  }, [proposal.id, proposal.privacyMode, wallet.account, wallet.connected]);

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
      if (await hasVoted(proposal.id, wallet.account, proposal.privacyMode)) {
        setAlreadyVoted(true);
        setStatus("error");
        return setMessage(ALREADY_VOTED_MESSAGE);
      }
      setMessage(proposal.privacyMode === "SecretSealed" ? "Submitting private ballot..." : "Submitting hidden vote commitment...");
      const contract = await wallet.getSignerContract();
      const { txHash: hash } = proposal.privacyMode === "SecretSealed"
        ? await submitPrivateBallot(contract, wallet.account, proposal, optionIndex)
        : await commitVote(contract, wallet.account, proposal.id, optionIndex);
      setTxHash(hash);
      setAlreadyVoted(true);
      setStatus("done");
      setMessage(proposal.privacyMode === "SecretSealed" ? "Private ballot submitted!" : "Vote committed!");
      onUpdate?.();
    } catch (err) {
      setStatus("error");
      setMessage(friendlyEvmError(err, "Vote submission failed."));
    }
  };

  const handleReveal = async () => {
    if (!pendingReveal) return setMessage("No local reveal secret found for this proposal.");
    try {
      setStatus("sending");
      setMessage("Revealing vote after deadline...");
      const contract = await wallet.getSignerContract();
      const hash = await revealVote(contract, wallet.account, pendingReveal);
      setTxHash(hash);
      setStatus("done");
      setMessage("Vote revealed!");
      onUpdate?.();
    } catch (err) {
      setStatus("error");
      setMessage(friendlyEvmError(err, "Vote reveal failed."));
    }
  };

  const copyForAgent = async () => {
    try {
      await navigator.clipboard.writeText(createAgentProposalBrief(proposal, wallet.account || undefined));
      setCopiedBrief(true);
      setMessage("Proposal brief copied. Paste it into your agent.");
      window.setTimeout(() => setCopiedBrief(false), 1800);
    } catch (error) {
      setStatus("error");
      setMessage(friendlyEvmError(error, "Could not copy the proposal brief."));
    }
  };

  const signForAgent = async () => {
    if (!wallet.connected) return setMessage("Connect wallet first");
    if (wallet.chainId !== BOT_CHAIN.chainId) return wallet.switchToBotChain();
    if (optionIndex === null) return setMessage("Select an option first");
    try {
      setStatus("sending");
      setMessage("Confirm the one-time vote signature in your wallet...");
      if (!(await checkEligibility(proposal.id, wallet.account))) throw new Error("This wallet is not eligible for the proposal.");
      if (await hasVoted(proposal.id, wallet.account, proposal.privacyMode)) {
        setAlreadyVoted(true);
        throw new Error(ALREADY_VOTED_MESSAGE);
      }
      const contract = await wallet.getSignerContract();
      const packet = await createVoterSignedVotePacket(contract, wallet.account, proposal, optionIndex);
      await navigator.clipboard.writeText(packet);
      setStatus("done");
      setMessage("One-time signed vote copied. Paste it into your agent within 15 minutes.");
    } catch (error) {
      setStatus("error");
      setMessage(friendlyEvmError(error, "Could not create the signed vote."));
    }
  };

  const statusColor =
    proposal.status === "Active" ? "status-active" :
      proposal.status === "Finalized" ? "status-ended" : "status-upcoming";

  const maxTally = Math.max(...(proposal.finalTally.length ? proposal.finalTally : [1]));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-drawer" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>

        <div className="modal-body">
          {/* Header */}
          <div className="modal-section" style={{ borderBottom: "1px solid var(--stroke)", paddingBottom: "24px", marginBottom: "24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", marginBottom: "12px" }}>
              <span className={`pill ${statusColor} glass-panel`}>{proposal.status}</span>
              <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Proposal #{proposal.id}</span>
              <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>·</span>
              <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                {proposal.privacyMode === "SecretSealed" ? "🔐 Secret Sealed" : "🔄 Commit-Reveal"}
              </span>
            </div>
            <h2 className="modal-title">{proposal.title}</h2>
          </div>

          <div className="modal-grid">
            {/* Left: Voting */}
            <div className="modal-col-main">
              <div className="modal-section">
                <h3 className="modal-section-title">
                  {proposal.status === "Finalized" ? "Final Results" : "Cast Your Vote"}
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {proposal.options.map((option, index) => {
                    const tally = proposal.finalTally[index] || 0;
                    const totalVotes = proposal.finalTally.reduce((a, b) => a + b, 0);
                    const pct = totalVotes > 0 ? Math.round((tally / totalVotes) * 100) : 0;
                    const isWinner = proposal.status === "Finalized" && tally === maxTally && maxTally > 0;
                    return (
                      <button
                        key={option}
                        className={`option-tile ${optionIndex === index ? "selected" : ""}`}
                        onClick={() => proposal.status === "Active" && setOptionIndex(index)}
                        disabled={proposal.status !== "Active" || checkingVote || alreadyVoted || (proposal.privacyMode === "CommitReveal" && Boolean(pendingReveal))}
                        style={{ position: "relative", width: "100%", padding: "16px 20px", textAlign: "left", overflow: "hidden", minHeight: "56px" }}
                      >
                        {proposal.status === "Finalized" && (
                          <span style={{
                            position: "absolute", top: 0, left: 0, bottom: 0,
                            width: `${pct}%`,
                            background: isWinner ? "rgba(217,183,94,0.16)" : "rgba(255,255,255,0.04)",
                            transition: "width 0.7s ease",
                            borderRadius: "inherit",
                          }} />
                        )}
                        <span style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontWeight: isWinner ? 700 : 400, color: isWinner ? "#fff" : "inherit" }}>
                            {isWinner ? "🏆 " : ""}{option}
                          </span>
                          {proposal.status === "Finalized" && (
                            <span style={{ fontSize: "13px", color: "var(--text-secondary)", marginLeft: "12px", whiteSpace: "nowrap" }}>
                              {tally} vote{tally !== 1 ? "s" : ""} · {pct}%
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div style={{ marginTop: "20px" }}>
                  {proposal.status === "Active" && (
                    <button
                      className="cta full-width"
                      onClick={handleVote}
                      disabled={checkingVote || alreadyVoted || status === "sending" || (proposal.privacyMode === "CommitReveal" && Boolean(pendingReveal))}
                    >
                      {checkingVote
                        ? "Checking Vote Status..."
                        : alreadyVoted
                          ? proposal.privacyMode === "SecretSealed" ? "Private Ballot Submitted" : "Hidden Vote Committed"
                          : proposal.privacyMode === "SecretSealed"
                            ? status === "sending" ? "Submitting..." : "Submit Private Ballot"
                            : pendingReveal ? "Hidden Vote Committed" : status === "sending" ? "Submitting..." : "Commit Hidden Vote"}
                    </button>
                  )}
                  {proposal.privacyMode === "SecretSealed" && proposal.status === "Active" && (
                    <div className="agent-ballot-actions">
                      <button className="button-ghost icon-command" type="button" onClick={copyForAgent}>
                        {copiedBrief ? <Check size={15} /> : <Copy size={15} />} {copiedBrief ? "Copied" : "Copy for agent"}
                      </button>
                      <button className="button-ghost icon-command" type="button" onClick={signForAgent} disabled={alreadyVoted || status === "sending" || optionIndex === null}>
                        <ShieldCheck size={15} /> Sign one-time agent vote
                      </button>
                    </div>
                  )}
                  {proposal.privacyMode === "CommitReveal" && proposal.status === "Reveal" && (
                    <button
                      className="cta full-width"
                      onClick={handleReveal}
                      disabled={status === "sending" || !pendingReveal}
                    >
                      {pendingReveal ? "Reveal My Vote" : "No Local Reveal Secret"}
                    </button>
                  )}
                </div>

                {message && (
                  <div className={`feedback-msg ${status === "done" ? "done" : status === "error" ? "error" : ""}`} style={{ marginTop: "14px" }}>
                    {message}
                    {txHash && (
                      <> · <a href={explorerTx(txHash)} target="_blank" rel="noreferrer" style={{ color: "var(--primary)" }}>View tx ↗</a></>
                    )}
                  </div>
                )}
              </div>

              {proposal.privacyMode === "SecretSealed" && proposal.status === "Tallying" && (
                <div className="modal-section pending-state-box" style={{ marginTop: "20px" }}>
                  <strong>⏳ Committee Tally Window</strong>
                  <p style={{ marginTop: "8px", color: "var(--text-secondary)" }}>
                    Waiting for {proposal.threshold - proposal.tallyApprovalCount} more committee approval{proposal.threshold - proposal.tallyApprovalCount !== 1 ? "s" : ""} to unlock the final tally.
                  </p>
                  <div style={{ marginTop: "12px", background: "rgba(255,255,255,0.06)", borderRadius: "6px", overflow: "hidden" }}>
                    <div style={{
                      height: "5px",
                      background: "linear-gradient(90deg, var(--primary), var(--secondary))",
                      width: `${Math.min(100, (proposal.tallyApprovalCount / Math.max(1, proposal.threshold)) * 100)}%`,
                      transition: "width 0.5s ease"
                    }} />
                  </div>
                </div>
              )}
            </div>

            {/* Right: Info sidebar */}
            <div className="modal-col-sidebar">
              {/* Timeline */}
              <div className="modal-info-card">
                <h3 className="modal-section-title">⏱ Timeline</h3>
                <div className="modal-detail-row">
                  <span className="modal-detail-label">Starts</span>
                  <span className="modal-detail-value">{formatDateTime(proposal.startTs)}</span>
                </div>
                <div className="modal-detail-row">
                  <span className="modal-detail-label">Ends</span>
                  <span className="modal-detail-value">{formatDateTime(proposal.endTs)}</span>
                </div>
                {proposal.privacyMode === "CommitReveal" && (
                  <div className="modal-detail-row">
                    <span className="modal-detail-label">Reveal By</span>
                    <span className="modal-detail-value">{formatDateTime(proposal.revealDeadline)}</span>
                  </div>
                )}
              </div>

              {/* Participation */}
              <div className="modal-info-card">
                <h3 className="modal-section-title">🗳 Participation</h3>
                <div className="modal-detail-row">
                  <span className="modal-detail-label">Eligibility</span>
                  <span className="modal-detail-value">{proposal.allowlistEnabled ? "Allowlist only" : "Public"}</span>
                </div>
                {proposal.allowlistEnabled && (
                  <div className="modal-detail-row">
                    <span className="modal-detail-label">Eligible voters</span>
                    <span className="modal-detail-value">{proposal.allowedVoterCount.toLocaleString()}</span>
                  </div>
                )}
                <div className="modal-detail-row">
                  <span className="modal-detail-label">{proposal.privacyMode === "SecretSealed" ? "Private ballots" : "Commitments"}</span>
                  <span className="modal-detail-value">{proposal.votesCast.toLocaleString()}</span>
                </div>
                {proposal.privacyMode === "CommitReveal" && (
                  <div className="modal-detail-row">
                    <span className="modal-detail-label">Revealed</span>
                    <span className="modal-detail-value">{proposal.revealCount.toLocaleString()}</span>
                  </div>
                )}
              </div>

              {/* Committee — only for SecretSealed */}
              {proposal.privacyMode === "SecretSealed" && (
                <div className="modal-info-card">
                  <h3 className="modal-section-title">👥 Committee</h3>
                  <div className="modal-detail-row">
                    <span className="modal-detail-label">Members</span>
                    <span className="modal-detail-value">{proposal.committeeMemberCount}</span>
                  </div>
                  <div className="modal-detail-row">
                    <span className="modal-detail-label">Required threshold</span>
                    <span className="modal-detail-value" style={{ color: "var(--primary)", fontWeight: 700 }}>
                      {proposal.threshold} of {proposal.committeeMemberCount}
                    </span>
                  </div>
                  <div className="modal-detail-row">
                    <span className="modal-detail-label">Approvals so far</span>
                    <span className="modal-detail-value">{proposal.tallyApprovalCount}</span>
                  </div>
                  <div style={{ marginTop: "12px", background: "rgba(255,255,255,0.06)", borderRadius: "6px", overflow: "hidden" }}>
                    <div style={{
                      height: "5px",
                      background: proposal.tallyApprovalCount >= proposal.threshold
                        ? "linear-gradient(90deg, #2ecc71, #27ae60)"
                        : "linear-gradient(90deg, var(--primary), var(--secondary))",
                      width: `${Math.min(100, (proposal.tallyApprovalCount / Math.max(1, proposal.threshold)) * 100)}%`,
                      transition: "width 0.5s ease",
                      borderRadius: "6px"
                    }} />
                  </div>
                  <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "8px" }}>
                    {proposal.tallyApprovalCount >= proposal.threshold
                      ? "✅ Threshold reached"
                      : `${proposal.threshold - proposal.tallyApprovalCount} more approval${proposal.threshold - proposal.tallyApprovalCount !== 1 ? "s" : ""} needed`}
                  </p>
                </div>
              )}

              {/* On-chain */}
              <div className="modal-info-card">
                <h3 className="modal-section-title">🔗 On-Chain</h3>
                <div className="modal-detail-row">
                  <span className="modal-detail-label">Contract</span>
                  <a href={explorerAddress(proposal.address)} target="_blank" rel="noreferrer"
                    style={{ fontSize: "12px", color: "var(--primary)", fontFamily: "monospace" }}>
                    {shortAddress(proposal.address)} ↗
                  </a>
                </div>
                <div className="modal-detail-row">
                  <span className="modal-detail-label">Creator</span>
                  <a href={explorerAddress(proposal.creator)} target="_blank" rel="noreferrer"
                    style={{ fontSize: "12px", color: "var(--primary)", fontFamily: "monospace" }}>
                    {shortAddress(proposal.creator)} ↗
                  </a>
                </div>
                <div className="modal-detail-row">
                  <span className="modal-detail-label">Privacy</span>
                  <span className="modal-detail-value">{proposal.privacyMode === "SecretSealed" ? "Secret Sealed" : "Commit-Reveal"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
