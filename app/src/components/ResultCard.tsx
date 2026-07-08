import { Link } from "react-router-dom";
import { type ProposalView } from "../lib/evm";

export function ResultCard({ proposal }: { proposal: ProposalView }) {
  const total = proposal.finalTally.reduce((sum, item) => sum + item, 0);
  const unrevealed = Math.max(0, proposal.votesCast - proposal.revealCount);
  const isThreshold = proposal.privacyMode === "SecretSealed";

  return (
    <div className="proposal-card">
      <div className="card-header">
        <div className="card-top">
          <span className="pill status-ended glass-panel">{proposal.status}</span>
          <span className="countdown">Proposal #{proposal.id}</span>
        </div>
        <h4 className="proposal-title">{proposal.title}</h4>
        <div className="card-meta">
          <span className="votes-count">{proposal.votesCast} {isThreshold ? "private ballots" : "commitments"}</span>
          <span className="votes-count">
            {isThreshold ? `${proposal.tallyApprovalCount}/${proposal.threshold} approvals` : `${proposal.revealCount} revealed`}
          </span>
          {!isThreshold && <span className="votes-count">{unrevealed} unrevealed</span>}
        </div>
        <p className="kpi" style={{ marginTop: "8px" }}>
          {proposal.allowlistEnabled ? `${proposal.allowedVoterCount} allowlisted voters` : "Public proposal"}
        </p>
      </div>

      <div className="card-content">
        {proposal.finalized ? (
          <div className="results-chart-section">
            {proposal.options.map((option, index) => {
              const votes = proposal.finalTally[index] || 0;
              const percent = total > 0 ? (votes / total) * 100 : 0;
              return (
                <div key={option} className="chart-row">
                  <div className="chart-labels">
                    <span className="opt-name">{option}</span>
                    <span className="opt-val">{votes} ({percent.toFixed(1)}%)</span>
                  </div>
                  <div className="chart-track">
                    <div className="chart-fill" style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="pending-state-box">
            <h3>Results Pending</h3>
            <p>
              {isThreshold
                ? "Committee members approve the secret-sealed tally after the deadline."
                : "Votes can be revealed after the deadline, then finalized on BOT Chain."}
            </p>
          </div>
        )}

        <Link to={`/results?proposal=${proposal.id}`} className="button-ghost full-width" style={{ marginTop: "16px", textAlign: "center" }}>
          View Details
        </Link>
      </div>
    </div>
  );
}
