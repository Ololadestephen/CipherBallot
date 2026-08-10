import { ChevronRight, Clock3, ShieldCheck, Vote } from "lucide-react";
import { Link } from "react-router-dom";
import type { ProposalView } from "../lib/evm";
import { proposalCode } from "../lib/proposalCode";

export function ResultCard({ proposal }: { proposal: ProposalView }) {
  const total = proposal.finalTally.reduce((sum, item) => sum + item, 0);
  const leadingIndex = proposal.finalTally.reduce((best, value, index, values) => value > (values[best] || 0) ? index : best, 0);
  const leadingOption = proposal.finalized && total > 0 ? proposal.options[leadingIndex] : null;
  const isThreshold = proposal.privacyMode === "SecretSealed";

  return (
    <Link to={`/results?proposal=${proposal.id}`} className="result-row">
      <div className="result-row-status">
        <span className={`pill status-${proposal.status.toLowerCase()}`}>{proposal.status}</span>
        <span>{proposalCode(proposal.id)}</span>
      </div>
      <div className="result-row-main">
        <h2>{proposal.title}</h2>
        <div>
          <span><Vote size={13} /> {proposal.votesCast} {isThreshold ? "private ballots" : "commitments"}</span>
          <span><ShieldCheck size={13} /> {isThreshold ? `${proposal.tallyApprovalCount}/${proposal.threshold} approvals` : `${proposal.revealCount} reveals`}</span>
          <span><Clock3 size={13} /> {proposal.allowlistEnabled ? `${proposal.allowedVoterCount} eligible` : "Public"}</span>
        </div>
      </div>
      <div className="result-row-outcome">
        <span>{leadingOption ? "Leading outcome" : "Outcome"}</span>
        <strong>{leadingOption || "Pending"}</strong>
      </div>
      <ChevronRight className="result-row-arrow" size={18} />
    </Link>
  );
}
