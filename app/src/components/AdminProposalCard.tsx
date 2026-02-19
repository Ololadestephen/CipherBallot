import { useState } from "react";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { type ProposalView } from "../lib/proposals";

export function AdminProposalCard({
    proposal,
    provider,
    onUpdate
}: {
    proposal: ProposalView;
    provider: anchor.AnchorProvider | null;
    onUpdate?: () => void;
}) {
    const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
    const [message, setMessage] = useState("");

    const handleInitTally = async () => {
        if (!provider) return setMessage("Connect wallet first");
        try {
            setStatus("sending");
            setMessage("Initializing encrypted tally...");
            const { initEncryptedTally } = await import("../lib/arcium");
            await initEncryptedTally({
                provider,
                proposalPubkey: new PublicKey(proposal.address),
                optionsCount: proposal.options.length
            });
            setStatus("success");
            setMessage("Tally initialized successfully");
            onUpdate?.();
        } catch (err: any) {
            console.error(err);
            setStatus("error");

            const errMsg = err instanceof Error ? err.message : String(err);
            if (errMsg.includes("0x1") || errMsg.includes("insufficient lamports")) {
                setMessage("Insufficient SOL balance to initialize tally (Rent).");
            } else {
                setMessage(errMsg || "Initialization failed");
            }
        }
    };

    const handleFinalize = async () => {
        if (!provider) return setMessage("Connect wallet first");
        try {
            setStatus("sending");
            setMessage("Finalizing tally computation...");
            const { finalizeEncryptedTally } = await import("../lib/arcium");
            await finalizeEncryptedTally({
                provider,
                proposalPubkey: new PublicKey(proposal.address),
                // results: Array(proposal.options.length).fill(10) // Removed
            });
            setStatus("success");
            setMessage("Tally finalized & revealed!");
            onUpdate?.();
        } catch (err: any) {
            console.error(err);
            setStatus("error");

            const errMsg = err instanceof Error ? err.message : String(err);
            if (errMsg.includes("0x1") || errMsg.includes("insufficient lamports")) {
                setMessage("Insufficient SOL to finalize (Rent/Gas).");
            } else {
                setMessage(errMsg || "Finalization failed");
            }
        }
    };

    const statusColor =
        proposal.status === "Active" ? "status-active" :
            proposal.status === "Ended" ? "status-ended" : "status-upcoming";

    return (
        <div className="proposal-card" style={{ height: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div className="card-header">
                <div className="card-top">
                    <span className={`pill ${statusColor} glass-panel`}>{proposal.status}</span>
                    <span className="votes-count">
                        {proposal.finalized ? (
                            `✓ ${proposal.votesCast} votes`
                        ) : (
                            <span title="Encrypted on-chain">🔒 {proposal.votesCast} encrypted</span>
                        )}
                    </span>
                </div>
                <h4 className="proposal-title">{proposal.title || `Proposal #${proposal.proposalId}`}</h4>
                <small className="address-hash" style={{ opacity: 0.6 }}>{proposal.address}</small>
            </div>

            <div className="card-content" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div className="card-footer" style={{ marginTop: 'auto', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {/* Action Logic */}
                    {!proposal.tallyInitialized && (
                        <div className="admin-action-group" style={{ width: '100%' }}>
                            <p className="kpi" style={{ marginBottom: '8px' }}>⚠️ Tally not initialized</p>
                            <button
                                className="cta full-width"
                                onClick={handleInitTally}
                                disabled={status === "sending"}
                            >
                                {status === "sending" ? "Initializing..." : "Initialize Tally"}
                            </button>
                        </div>
                    )}

                    {proposal.tallyInitialized && proposal.status === "Ended" && !proposal.finalized && (
                        <div className="admin-action-group" style={{ width: '100%' }}>
                            <button
                                className="cta full-width"
                                onClick={handleFinalize}
                                disabled={status === "sending"}
                            >
                                {status === "sending" ? "Finalizing..." : "Finalize & Reveal"}
                            </button>
                        </div>
                    )}

                    {proposal.finalized && (
                        <div className="admin-action-group" style={{ width: '100%' }}>
                            <a href={`/results?proposal=${proposal.address}`} className="button-ghost full-width" style={{ textAlign: 'center', display: 'block' }}>
                                View Results
                            </a>
                        </div>
                    )}

                    <div className="options-vertical-stack" style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
                        {(proposal.options.length ? proposal.options : ["Option 1", "Option 2"]).map((opt, idx) => {
                            const label = opt || `Option ${idx + 1}`;
                            return (
                                <button
                                    key={idx}
                                    className="option-tile"
                                    disabled={true} // Admin view is read-only for options usually
                                    style={{
                                        display: 'block',
                                        width: '100%',
                                        height: 'auto',
                                        minHeight: '3.5rem',
                                        padding: '16px 20px',
                                        whiteSpace: 'normal',
                                        textAlign: 'left',
                                        wordBreak: 'normal',
                                        overflowWrap: 'break-word',
                                        cursor: 'default',
                                        background: '#111',
                                        border: '1px solid var(--stroke)',
                                        borderRadius: '12px',
                                        color: '#aaa'
                                    }}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>

                    {message && (
                        <div className={`feedback-msg ${status === 'success' ? 'done' : status === 'error' ? 'error' : ''}`}>
                            {message}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
