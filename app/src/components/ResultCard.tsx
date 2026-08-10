import { ChevronRight, Clock3, ShieldCheck, Vote } from "lucide-react";
import { Link } from "react-router-dom";
import type { ProposalView } from "../lib/evm";
import { proposalCode } from "../lib/proposalCode";
import { getFinalResult } from "../lib/resultOutcome";

export function ResultCard({ proposal }: { proposal: ProposalView }) {
  const finalResult = getFinalResult(proposal);
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
      <div className={`result-row-outcome ${finalResult ? "is-final" : ""}`}>
        <span>{finalResult ? "Final result" : "Result status"}</span>
        <strong>{finalResult?.label || "Awaiting finalization"}</strong>
      </div>
      <ChevronRight className="result-row-arrow" size={18} />
    </Link>
  );
}
