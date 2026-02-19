import { useConnection } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  fetchProposalByAddress,
  fetchProposals,
  type ProposalView
} from "../lib/proposals";
// Assuming ResultCard is exported from components (I just created it)
import { ResultCard } from "../components/ResultCard";

function shortHex(val: number[] | string): string {
  if (!val) return "-";
  if (typeof val === "string") return `${val.slice(0, 8)}...${val.slice(-8)}`;
  const hex = val.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 20)}...${hex.slice(-12)}`;
}

export default function Results() {
  const { connection } = useConnection();
  const [searchParams] = useSearchParams();
  const proposalQuery = searchParams.get("proposal");

  const [rows, setRows] = useState<ProposalView[]>([]);
  const [selected, setSelected] = useState<ProposalView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadResults = useCallback(
    async (withLoading = false) => {
      try {
        if (withLoading) setLoading(true);
        setError("");

        // If a specific proposal is requested via URL
        if (proposalQuery) {
          const proposal = await fetchProposalByAddress(connection, proposalQuery);
          setSelected(proposal);
          setRows([proposal]);
        } else {
          // Otherwise fetch all
          const all = await fetchProposals(connection);
          // Sort by finalized first -> then active -> then newer start time
          all.sort((a, b) => {
            if (a.finalized !== b.finalized) return a.finalized ? -1 : 1;
            return b.startTs - a.startTs;
          });
          setRows(all);
          setSelected(null);
        }
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : "Failed to load results.");
      } finally {
        if (withLoading) setLoading(false);
      }
    },
    [connection, proposalQuery]
  );

  useEffect(() => {
    void loadResults(true);
    const interval = setInterval(() => void loadResults(false), 5000);
    return () => clearInterval(interval);
  }, [loadResults]);

  // --- RENDER DETAIL VIEW ---
  if (selected && proposalQuery) {
    const totalVotes = selected.finalized
      ? selected.finalTally.reduce((a, b) => a + b, 0)
      : 0;

    // Determine winner index
    let winnerIndex = -1;
    let maxVotes = -1;
    if (selected.finalized) {
      selected.finalTally.forEach((v, i) => {
        if (v > maxVotes) {
          maxVotes = v;
          winnerIndex = i;
        } else if (v === maxVotes) {
          winnerIndex = -1; // Tie
        }
      });
    }

    return (
      <div className="results-detail-container">
        <Link to="/results" className="back-link">← Back to All Results</Link>

        <div className="proposal-card detail-card" style={{ marginTop: '20px' }}>
          <div className="detail-header">
            <h1 className="detail-title">{selected.title}</h1>
            <div className="meta-row">
              <span className={`pill status-${selected.status.toLowerCase()}`}>{selected.status}</span>
              <span className="metadata-item">{selected.votesCast} Votes Cast</span>
              <span className="metadata-item address-hash">{shortHex(selected.address)}</span>
            </div>
          </div>

          <div className="results-chart-section">
            {selected.finalized ? (
              selected.options.map((opt, i) => {
                const votes = selected.finalTally[i] || 0;
                const percentage = totalVotes > 0 ? (votes / totalVotes) * 100 : 0;
                const isWinner = i === winnerIndex;

                return (
                  <div key={i} className={`chart-row ${isWinner ? 'winner-row' : ''}`}>
                    <div className="chart-labels">
                      <span className="opt-name">{opt}</span>
                      <span className="opt-val">{votes} ({percentage.toFixed(1)}%)</span>
                    </div>
                    <div className="chart-track">
                      <div
                        className="chart-fill"
                        style={{ width: `${percentage}%`, background: isWinner ? 'var(--accent)' : 'var(--muted)' }}
                      ></div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="pending-state-box">
                <h3>Encryption Active</h3>
                <p>Votes are encrypted on-chain. Results will be revealed after the proposal is finalized.</p>
              </div>
            )}
          </div>

          {selected.finalized && (
            <div className="verification-box">
              <h4>✓ On-Chain Verification</h4>
              <p style={{ fontSize: '13px', fontFamily: 'monospace', color: 'var(--muted)' }}>
                Sig: {shortHex(selected.finalizationSig)}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- RENDER GRID VIEW ---
  return (
    <div className="results-overview">
      <div className="voters-header">
        <div>
          <h3 className="section-title">Election Results</h3>
          <p className="hero-copy" style={{ fontSize: '16px', margin: 0, opacity: 0.7 }}>Outcomes of finalized proposals.</p>
        </div>
      </div>

      {loading ? (
        <div className="loading-state">Syncing with Solana...</div>
      ) : error ? (
        <div className="feedback-msg error">{error}</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">No proposals found on this cluster.</div>
      ) : (
        <div className="proposal-grid">
          {rows.map(p => (
            <ResultCard key={p.address} proposal={p} />
          ))}
        </div>
      )}
    </div>
  );
}
