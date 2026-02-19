import { useConnection } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchProposalByAddress, subscribeProposalChanges, type ProposalView } from "../lib/proposals";

function formatDateTime(ts: number): string {
  if (!ts) return "-";
  return new Date(ts * 1000).toLocaleString();
}

export default function ProposalDetails() {
  const { connection } = useConnection();
  const { id } = useParams<{ id: string }>();
  const [proposal, setProposal] = useState<ProposalView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadProposal = useCallback(
    async (withLoading = false) => {
      if (!id) {
        setError("Missing proposal id.");
        if (withLoading) setLoading(false);
        return;
      }
      try {
        if (withLoading) setLoading(true);
        setError("");
        const row = await fetchProposalByAddress(connection, id);
        setProposal(row);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch proposal.");
      } finally {
        if (withLoading) setLoading(false);
      }
    },
    [connection, id]
  );

  useEffect(() => {
    let alive = true;
    void loadProposal(true);
    const intervalId = window.setInterval(() => {
      if (!alive) return;
      void loadProposal(false);
    }, 3000);
    const unsubscribe = subscribeProposalChanges(connection, () => {
      if (!alive) return;
      void loadProposal(false);
    });
    return () => {
      alive = false;
      window.clearInterval(intervalId);
      unsubscribe();
    };
  }, [connection, loadProposal]);

  const tallyRows = useMemo(() => {
    if (!proposal) return [];
    return proposal.options.map((label, index) => ({
      label,
      votes: proposal.finalized ? proposal.finalTally[index] ?? 0 : null
    }));
  }, [proposal]);

  return (
    <section>
      <h3 className="section-title">Proposal Details</h3>
      {loading && <div className="card">Loading proposal from Solana...</div>}
      {error && <div className="card error-card">{error}</div>}
      {!loading && !error && proposal && (
        <>
          <div className="card">
            <strong>{proposal.title || `Proposal #${proposal.proposalId}`}</strong>
            <p className="kpi">Address: {proposal.address}</p>
            <p className="kpi">Creator: {proposal.creator}</p>
            <p className="kpi">Proposal ID: {proposal.proposalId}</p>
            <p className="kpi">
              Status: <span className={`pill status-${proposal.status.toLowerCase()}`}>{proposal.status}</span>
            </p>
            <p className="kpi">Starts: {formatDateTime(proposal.startTs)}</p>
            <p className="kpi">Ends: {formatDateTime(proposal.endTs)}</p>
            <p className="kpi">Votes cast: {proposal.votesCast}</p>
            <p className="kpi">Tally initialized: {proposal.tallyInitialized ? "Yes" : "No"}</p>
            <p className="kpi">Finalized: {proposal.finalized ? "Yes" : "No"}</p>
            <p className="kpi">
              Eligibility:{" "}
              {proposal.eligibilityMode === 0
                ? "Anyone with Solana wallet"
                : proposal.eligibilityMode === 1
                  ? "Whitelist only"
                  : "Token gated"}
            </p>
            {proposal.eligibilityMode === 2 && <p className="kpi">Required mint: {proposal.requiredMint}</p>}
            {proposal.eligibilityMode === 1 && <p className="kpi">Whitelist size: {proposal.whitelist.length}</p>}
          </div>

          <div className="card">
            <strong>Voting Options</strong>
            <div className="proposal-list">
              {tallyRows.map((row, index) => (
                <div className="proposal" key={`${row.label}-${index}`}>
                  <div>
                    <h4>{row.label}</h4>
                    <small>Option {index + 1}</small>
                  </div>
                  <div className="kpi">
                    {row.votes === null ? "Votes hidden until finalization" : `Final votes: ${row.votes}`}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="actions">
            <Link className="button-ghost" to={`/voters?proposal=${proposal.address}`}>
              Cast Vote
            </Link>
            <Link className="button-ghost" to={`/results?proposal=${proposal.address}`}>
              View Results
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
