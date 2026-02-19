import { Link } from "react-router-dom";
import { type ProposalView } from "../lib/proposals";

export function ResultCard({ proposal }: { proposal: ProposalView }) {
    const statusColor =
        proposal.status === "Active" ? "status-active" :
            proposal.status === "Ended" ? "status-ended" : "status-upcoming";

    // Find winner if finalized
    let winnerLabel = "";
    let highestVotes = -1;

    if (proposal.finalized && proposal.finalTally.length > 0) {
        proposal.finalTally.forEach((count, idx) => {
            if (count > highestVotes) {
                highestVotes = count;
                winnerLabel = proposal.options[idx];
            } else if (count === highestVotes) {
                winnerLabel = "Tie";
            }
        });
    }

    return (
        <Link to={`/results?proposal=${proposal.address}`} className="proposal-card result-card-link">
            <div className="card-header">
                <div className="card-top">
                    <span className={`pill ${statusColor}`}>{proposal.status}</span>
                    <span className="votes-count">{proposal.votesCast} votes</span>
                </div>
                <h4 className="proposal-title">{proposal.title || `Proposal #${proposal.proposalId}`}</h4>
                <small className="address-hash">{proposal.address.slice(0, 8)}...</small>
            </div>

            <div className="card-content">
                {proposal.finalized ? (
                    <div className="winner-preview">
                        <span className="label">Result:</span>
                        <span className="value">{winnerLabel}</span>
                    </div>
                ) : (
                    <div className="winner-preview pending">
                        <span className="label">Status:</span>
                        <span className="value">Tallying Pending</span>
                    </div>
                )}

                <div className="card-footer" style={{ marginTop: 'auto', padding: '16px 0 0' }}>
                    <span className="button-ghost full-width" style={{ textAlign: 'center', display: 'block' }}>
                        View Details
                    </span>
                </div>
            </div>
        </Link>
    );
}
