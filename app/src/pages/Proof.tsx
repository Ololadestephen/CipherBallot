import { useEffect, useState } from "react";
import {
  BOT_CHAIN,
  CONTRACT_ADDRESS,
  explorerAddress,
  fetchProofStats,
  shortAddress,
  type ProofStats
} from "../lib/evm";

export default function Proof() {
  const [stats, setStats] = useState<ProofStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadStats = async () => {
    try {
      setError("");
      setStats(await fetchProofStats());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load BOT Chain proof data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStats();
    const id = window.setInterval(() => void loadStats(), 10000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section>
      <div className="voters-header">
        <div>
          <h3 className="section-title">BOT Chain Proof</h3>
          <p className="hero-copy" style={{ fontSize: "16px", margin: 0, opacity: 0.7 }}>
            Live verification signals for the CipherBallot contract and proposal activity.
          </p>
        </div>
      </div>

      {!CONTRACT_ADDRESS && (
        <div className="feedback-msg error">
          Set VITE_CIPHERBALLOT_CONTRACT_ADDRESS to enable proof data.
        </div>
      )}

      {loading ? (
        <div className="loading-state">Loading BOT Chain proof...</div>
      ) : error ? (
        <div className="feedback-msg error">{error}</div>
      ) : stats ? (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-label">Network</span>
              <span className="stat-value">BOT</span>
              <span className="stat-desc">Chain ID {stats.chainId}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Latest Block</span>
              <span className="stat-value">{stats.latestBlock.toLocaleString()}</span>
              <span className="stat-desc">Read from {BOT_CHAIN.rpcUrl}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Contract</span>
              <span className="stat-value">{shortAddress(stats.contractAddress)}</span>
              <span className="stat-desc">
                <a href={explorerAddress(stats.contractAddress)} target="_blank" rel="noreferrer">View on explorer</a>
              </span>
            </div>
          </div>

          <div className="grid" style={{ marginTop: "24px" }}>
            <div className="card">
              <strong>Proposal Activity</strong>
              <p>{stats.proposalCount} total proposals</p>
              <p>{stats.activeCount} active · {stats.revealCount} in reveal · {stats.tallyingCount} tallying · {stats.finalizedCount} finalized</p>
            </div>
            <div className="card">
              <strong>Privacy Health</strong>
              <p>{stats.thresholdProposalCount} threshold proposals</p>
              <p>{stats.totalCommitments} private ballots · {stats.totalTallyApprovals} tally approvals</p>
            </div>
            <div className="card">
              <strong>Judging Evidence</strong>
              <p>Contract address, proposal state, private ballot counts, committee approvals, and final tallies are all read from BOT Chain.</p>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
