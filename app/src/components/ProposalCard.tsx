import { Bot, Check, ChevronDown, Clock3, Copy, ShieldCheck, Users } from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link } from "react-router-dom";
import {
  ALREADY_VOTED_MESSAGE,
  BOT_CHAIN,
  checkEligibility,
  commitVote,
  createAgentProposalBrief,
  createVoterSignedVotePacket,
  friendlyEvmError,
  formatDateTime,
  getPendingReveals,
  hasVoted,
  revealVote,
  shortAddress,
  submitPrivateBallot,
  type ProposalView,
  useEvmWallet
} from "../lib/evm";
import { proposalCode } from "../lib/proposalCode";

export function ProposalCard({
  proposal,
  onUpdate,
  defaultExpanded = false
}: {
  proposal: ProposalView;
  onUpdate?: () => void;
  defaultExpanded?: boolean;
}) {
  const wallet = useEvmWallet();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [optionIndex, setOptionIndex] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [alreadyVoted, setAlreadyVoted] = useState(false);
  const [checkingVote, setCheckingVote] = useState(false);
  const [copiedBrief, setCopiedBrief] = useState(false);
  const [activePanel, setActivePanel] = useState<"vote" | "agent">("vote");

  const pendingReveal = useMemo(
    () => getPendingReveals(wallet.account).find((item) => item.proposalId === proposal.id),
    [wallet.account, proposal.id, status]
  );

  const showAgentPanel = proposal.privacyMode === "SecretSealed" && proposal.status === "Active";
  const voteTabId = `proposal-${proposal.id}-vote-tab`;
  const votePanelId = `proposal-${proposal.id}-vote-panel`;
  const agentTabId = `proposal-${proposal.id}-agent-tab`;
  const agentPanelId = `proposal-${proposal.id}-agent-panel`;

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

  useEffect(() => {
    if (!showAgentPanel && activePanel === "agent") setActivePanel("vote");
  }, [showAgentPanel, activePanel]);

  const handlePanelTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextPanel = event.key === "Home"
      ? "vote"
      : event.key === "End"
        ? "agent"
        : activePanel === "vote"
          ? "agent"
          : "vote";
    setActivePanel(nextPanel);
    window.requestAnimationFrame(() => {
      document.getElementById(nextPanel === "vote" ? voteTabId : agentTabId)?.focus();
    });
  };

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
      const { txHash } = proposal.privacyMode === "SecretSealed"
        ? await submitPrivateBallot(contract, wallet.account, proposal, optionIndex)
        : await commitVote(contract, wallet.account, proposal.id, optionIndex);
      setAlreadyVoted(true);
      setStatus("done");
      setMessage(proposal.privacyMode === "SecretSealed" ? `Private ballot submitted: ${shortAddress(txHash)}` : `Vote committed: ${shortAddress(txHash)}`);
      onUpdate?.();
    } catch (error) {
      setStatus("error");
      setMessage(friendlyEvmError(error, "Vote submission failed."));
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
    } catch (error) {
      setStatus("error");
      setMessage(friendlyEvmError(error, "Vote reveal failed."));
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

  const deadlineText = proposal.status === "Finalized"
    ? `Voting ended ${formatDateTime(proposal.endTs)}`
    : proposal.status === "Reveal"
      ? `Reveal deadline ${formatDateTime(proposal.revealDeadline)}`
      : proposal.status === "Tallying"
        ? `Voting ended ${formatDateTime(proposal.endTs)}`
        : `Voting ends ${formatDateTime(proposal.endTs)}`;

  return (
    <article className={`proposal-card expandable-card ${isExpanded ? "expanded" : ""}`}>
      <div
        className="proposal-card-summary"
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((expanded) => !expanded)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setIsExpanded((expanded) => !expanded);
          }
        }}
      >
        <div className="proposal-card-topline">
          <span className={`pill status-${proposal.status.toLowerCase()}`}>{proposal.status}</span>
          <span className="proposal-number">{proposalCode(proposal.id)}</span>
          {proposal.privacyMode === "SecretSealed" && (
            <span className="proposal-mode-chip">Sealed</span>
          )}
          <ChevronDown className="proposal-chevron" size={17} />
        </div>
        <h2>{proposal.title}</h2>

        <div className="proposal-facts">
          <span><Users size={14} /> {proposal.allowlistEnabled ? `${proposal.allowedVoterCount} eligible` : "Public vote"}</span>
          {proposal.privacyMode === "SecretSealed" && proposal.status === "Tallying" && (
            <span><ShieldCheck size={14} /> {proposal.tallyApprovalCount}/{proposal.threshold} approvals</span>
          )}
        </div>

        <div className="proposal-deadline">
          <Clock3 size={14} />
          <span>{deadlineText}</span>
        </div>
      </div>

      <div className="proposal-card-content">
        {showAgentPanel && (
          <div className="proposal-panel-tabs" role="tablist" aria-label="Ballot actions">
            <button
              type="button"
              id={voteTabId}
              role="tab"
              aria-selected={activePanel === "vote"}
              aria-controls={votePanelId}
              tabIndex={activePanel === "vote" ? 0 : -1}
              className={activePanel === "vote" ? "active" : ""}
              onClick={() => setActivePanel("vote")}
              onKeyDown={handlePanelTabKeyDown}
            >
              Your ballot
            </button>
            <button
              type="button"
              id={agentTabId}
              role="tab"
              aria-selected={activePanel === "agent"}
              aria-controls={agentPanelId}
              tabIndex={activePanel === "agent" ? 0 : -1}
              className={activePanel === "agent" ? "active" : ""}
              onClick={() => setActivePanel("agent")}
              onKeyDown={handlePanelTabKeyDown}
            >
              <Bot size={14} aria-hidden="true" /> Agent path
            </button>
          </div>
        )}

        <div className="option-list-vote" role="group" aria-label="Ballot options">
          {proposal.options.map((option, index) => (
            <button
              type="button"
              key={option}
              className={`option-tile ${optionIndex === index ? "selected" : ""}`}
              onClick={() => setOptionIndex(index)}
              disabled={proposal.status !== "Active" || checkingVote || alreadyVoted || (proposal.privacyMode === "CommitReveal" && Boolean(pendingReveal))}
            >
              <span>{String.fromCharCode(65 + index)}</span>
              {option}
            </button>
          ))}
        </div>

        {(!showAgentPanel || activePanel === "vote") && (
          <div
            id={votePanelId}
            className="proposal-vote-panel"
            role={showAgentPanel ? "tabpanel" : undefined}
            aria-labelledby={showAgentPanel ? voteTabId : undefined}
          >
            {proposal.status === "Active" && (
              <button className="cta full-width" onClick={handleVote} disabled={checkingVote || alreadyVoted || status === "sending" || (proposal.privacyMode === "CommitReveal" && Boolean(pendingReveal))}>
                {checkingVote
                  ? "Checking vote status..."
                  : alreadyVoted
                    ? proposal.privacyMode === "SecretSealed" ? "Private ballot submitted" : "Hidden vote committed"
                    : proposal.privacyMode === "SecretSealed"
                      ? status === "sending" ? "Submitting..." : "Submit private ballot"
                      : pendingReveal ? "Hidden vote committed" : status === "sending" ? "Submitting..." : "Commit hidden vote"}
              </button>
            )}

            {proposal.privacyMode === "CommitReveal" && proposal.status === "Reveal" && (
              <button className="cta full-width" onClick={handleReveal} disabled={status === "sending" || !pendingReveal}>
                {pendingReveal ? "Reveal my vote" : "No local reveal secret"}
              </button>
            )}

            {proposal.privacyMode === "SecretSealed" && proposal.status === "Tallying" && (
              <div className="inline-state-panel gold">
                <strong>Committee tally window</strong>
                <span>{proposal.tallyApprovalCount} of {proposal.threshold} approvals are on-chain.</span>
              </div>
            )}

            {proposal.status === "Finalized" && (
              <div className="compact-results">
                {proposal.options.map((option, index) => (
                  <div key={option}><span>{option}</span><strong>{proposal.finalTally[index] || 0}</strong></div>
                ))}
              </div>
            )}
          </div>
        )}

        {showAgentPanel && activePanel === "agent" && (
          <div id={agentPanelId} className="proposal-agent-panel" role="tabpanel" aria-labelledby={agentTabId}>
            <p className="proposal-agent-copy">
              Hand this proposal to an agent without sharing your private key. Select an option first for a one-time signed relay.
            </p>
            <div className="agent-ballot-actions">
              <button className="button-ghost icon-command" type="button" onClick={copyForAgent}>
                {copiedBrief ? <Check size={15} /> : <Copy size={15} />} {copiedBrief ? "Copied" : "Copy for agent"}
              </button>
              <button className="cta icon-command" type="button" onClick={signForAgent} disabled={alreadyVoted || status === "sending" || optionIndex === null}>
                <ShieldCheck size={15} /> Sign one-time agent vote
              </button>
            </div>
            <Link className="proposal-agent-link" to="/agents">Manage scoped agent access</Link>
          </div>
        )}

        {message && <p className={`feedback-msg ${status === "done" ? "done" : status === "error" ? "error" : ""}`}>{message}</p>}
      </div>
    </article>
  );
}
