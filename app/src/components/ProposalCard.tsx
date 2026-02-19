import { useState, useEffect } from "react";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { type ProposalView } from "../lib/proposals";

export function ProposalCard({
    proposal,
    provider
}: {
    proposal: ProposalView;
    provider: anchor.AnchorProvider | null;
}) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [optionIndex, setOptionIndex] = useState<number | null>(null);
    const [voteStatus, setVoteStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
    const [message, setMessage] = useState("");
    const [hasVoted, setHasVoted] = useState(false);

    useEffect(() => {
        if (provider) {
            import("../lib/arcium").then(({ hasUserVoted }) => {
                hasUserVoted(provider, new PublicKey(proposal.address))
                    .then(setHasVoted)
                    .catch(e => console.error("Failed to check vote status", e));
            });
        }
    }, [provider, proposal.address, voteStatus]); // Re-check after voteStatus changes (to 'done')

    const handleVote = async () => {
        if (!provider) return setMessage("Please connect wallet");
        if (optionIndex === null) return setMessage("Select an option");

        try {
            setVoteStatus("sending");
            setMessage("Encrypting & transmitting...");
            const { submitEncryptedVote } = await import("../lib/arcium");

            await submitEncryptedVote({
                provider,
                proposalPubkey: new PublicKey(proposal.address),
                optionIndex,
                // Only pass mint if eligibilityMode is 2 (Token Gated).
                // Otherwise pass undefined so arcium.ts uses PROGRAM_ID as placeholder.
                mint: proposal.eligibilityMode === 2 && proposal.requiredMint ? new PublicKey(proposal.requiredMint) : undefined
            });

            setVoteStatus("done");
            setMessage("Vote Cast Successfully!");
            setTimeout(() => {
                setIsExpanded(false);
                setVoteStatus("idle");
                setMessage("");
            }, 2000);
        } catch (err: any) {
            console.error(err);
            setVoteStatus("error");

            const errMsg = err instanceof Error ? err.message : String(err);
            if (errMsg.includes("0x1") || errMsg.includes("insufficient lamports")) {
                setMessage("Insufficient SOL balance to cast vote.");
            } else {
                setMessage(errMsg || "Voting failed");
            }
        }
    };

    const statusColor =
        proposal.status === "Active" ? "status-active" :
            proposal.status === "Ended" ? "status-ended" : "status-upcoming";

    function getTimeRemaining(endTs: number) {
        const now = Date.now() / 1000;
        const diff = endTs - now;
        if (diff <= 0) return "Ended";
        const days = Math.floor(diff / 86400);
        const hours = Math.floor((diff % 86400) / 3600);
        const minutes = Math.floor((diff % 3600) / 60);
        if (days > 0) return `Ends in ${days}d ${hours}h`;
        return `Ends in ${hours}h ${minutes}m`;
    }

    const isWhitelisted = proposal.eligibilityMode === 1
        ? (provider && proposal.whitelist.includes(provider.wallet.publicKey.toBase58()))
        : true;

    const canVote = proposal.status === "Active" && !hasVoted && isWhitelisted;

    return (
        <div className={`proposal-card ${isExpanded ? "expanded" : ""}`}>
            <div className="card-header">
                <div className="card-top">
                    <span className={`pill ${statusColor} glass-panel`}>{proposal.status}</span>
                    <span className="countdown">{getTimeRemaining(proposal.endTs)}</span>
                </div>
                <h4 className="proposal-title">{proposal.title || `Proposal #${proposal.proposalId}`}</h4>
                <div className="card-meta">
                    <span className="votes-count">
                        {proposal.finalized ? (
                            `✓ ${proposal.votesCast} votes`
                        ) : (
                            <span title="Encrypted on-chain" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                🔒 {proposal.votesCast} encrypted
                            </span>
                        )}
                    </span>
                    <small className="address-hash" style={{ opacity: 0.6 }}>{proposal.address.slice(0, 4)}...{proposal.address.slice(-4)}</small>
                </div>
            </div>

            <div className="card-content">
                {isExpanded ? (
                    <div className="vote-interface">
                        <p className="instruction">Select your choice:</p>
                        <div className="options-grid">
                            {(proposal.options.length ? proposal.options : ["Option 1", "Option 2"]).map((opt, idx) => {
                                const label = opt || `Option ${idx + 1}`;
                                return (
                                    <button
                                        key={idx}
                                        className={`option-tile ${optionIndex === idx ? "selected" : ""}`}
                                        onClick={() => setOptionIndex(idx)}
                                        disabled={hasVoted}
                                    >
                                        {label}
                                    </button>
                                );
                            })}
                        </div>

                        <div className="action-row">
                            <button
                                className="button-ghost small"
                                onClick={() => setIsExpanded(false)}
                                disabled={voteStatus === "sending"}
                            >
                                Cancel
                            </button>
                            <button
                                className="cta"
                                onClick={handleVote}
                                disabled={voteStatus === "sending" || optionIndex === null || hasVoted}
                            >
                                {hasVoted ? "Already Voted" :
                                    voteStatus === "sending" ? "Submitting..." :
                                        voteStatus === "done" ? "Success" : "Confirm Vote"}
                            </button>
                        </div>
                        {hasVoted && <p className="feedback-msg info">You have already voted on this proposal.</p>}
                        {message && <p className={`feedback-msg ${voteStatus === 'done' ? 'done' : voteStatus === 'error' ? 'error' : ''}`}>{message}</p>}
                    </div>
                ) : (
                    <div className="card-footer">
                        <button
                            className="button-ghost full-width compact-btn"
                            onClick={() => setIsExpanded(true)}
                            disabled={!canVote}
                        >
                            {hasVoted ? "Already Voted" :
                                !isWhitelisted ? "Not Whitelisted" :
                                    proposal.status === "Active" ? "Cast Encrypted Vote" :
                                        proposal.status === "Ended" ? "Voting Ended" : "Voting Starts Soon"}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
