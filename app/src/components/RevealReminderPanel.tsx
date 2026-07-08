import { Link } from "react-router-dom";
import { formatDateTime, getPendingReveals, type ProposalView, useEvmWallet } from "../lib/evm";

export function RevealReminderPanel({ proposals }: { proposals: ProposalView[] }) {
  const wallet = useEvmWallet();
  const pending = getPendingReveals(wallet.account)
    .map((item) => ({
      ...item,
      proposal: proposals.find((proposal) => proposal.id === item.proposalId)
    }))
    .filter((item) => item.proposal);

  if (!wallet.connected || pending.length === 0) return null;

  return (
    <div className="proposal-card" style={{ marginBottom: "24px" }}>
      <div className="card-header">
        <div className="card-top">
          <span className="pill status-active glass-panel">Reveal Reminder</span>
          <span className="countdown">{pending.length} pending</span>
        </div>
        <h4 className="proposal-title">You have hidden votes waiting for reveal</h4>
        <p className="hero-copy" style={{ fontSize: "14px", margin: "8px 0 0", maxWidth: "none" }}>
          CipherBallot stores your reveal secret locally after you commit. Return after the deadline and reveal so your vote can be counted.
        </p>
      </div>

      <div className="card-content">
        <div className="grid">
          {pending.map(({ proposalId, optionIndex, proposal }) => (
            <div className="card" key={proposalId}>
              <strong>Proposal #{proposalId}</strong>
              <p>{proposal?.title}</p>
              <p>Selected option: #{optionIndex + 1}</p>
              <p>
                {proposal?.status === "Active"
                  ? `Reveal opens after ${formatDateTime(proposal.endTs)}`
                  : proposal?.status === "Reveal"
                    ? "Reveal is open now."
                    : "Proposal is already finalized."}
              </p>
              <Link className="button-ghost full-width" to={`/proposal/${proposalId}`}>
                Open Proposal
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

