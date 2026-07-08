import { Link } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CONTRACT_ADDRESS, fetchProposals, type ProposalView } from "../lib/evm";
import { ProposalCard } from "../components/ProposalCard";

const steps = [
  { label: "Connect", desc: "Use an EVM wallet" },
  { label: "Vote", desc: "Submit one private ballot" },
  { label: "Approve", desc: "Committee reaches threshold" },
  { label: "Verify", desc: "Audit the final tally on-chain" }
];

export default function Home() {
  const [proposals, setProposals] = useState<ProposalView[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProposals = useCallback(async () => {
    try {
      setLoading(true);
      setProposals(await fetchProposals());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProposals();
  }, [loadProposals]);

  const totalVotes = useMemo(() => proposals.reduce((sum, p) => sum + p.votesCast, 0), [proposals]);
  const featuredProposals = useMemo(() => proposals.filter((p) => p.status === "Active").slice(0, 3), [proposals]);

  return (
    <>
      <section className="home-hero">
        <div className="hero-content">
          <span className="hero-badge">BOT Chain Threshold Governance</span>
          <h1 className="hero-title">
            Your Vote, <span className="text-gradient">Hidden.</span><br />
            Your Result, <span className="text-white">Verifiable.</span>
          </h1>
          <p className="hero-copy">
            CipherBallot lets communities run private governance on BOT Chain. Voters submit private ballots once, then a threshold committee approves the final tally after the deadline.
          </p>
          <div className="home-hero-actions">
            <Link className="cta" to="/voters">Vote Now</Link>
            <Link className="button-ghost" to="/creators">Create Proposal</Link>
          </div>
        </div>
      </section>

      {!CONTRACT_ADDRESS && (
        <div className="feedback-msg error">
          Set VITE_CIPHERBALLOT_CONTRACT_ADDRESS to connect the frontend to the BOT Chain contract.
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">Private Ballots</span>
          <span className="stat-value">{totalVotes.toLocaleString()}</span>
          <span className="stat-desc">Submitted on BOT Chain</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Governance</span>
          <span className="stat-value">{proposals.length}</span>
          <span className="stat-desc">BOT Chain proposals</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Privacy Model</span>
          <span className="stat-value text-gradient">Threshold</span>
          <span className="stat-desc">No single coordinator finalizes</span>
        </div>
      </div>

      <section className="featured-section">
        <div className="section-header">
          <h3>Featured Active Proposals</h3>
          <Link to="/voters" className="link-arrow">View All &rarr;</Link>
        </div>

        {loading ? (
          <div className="loading-state">Loading proposals...</div>
        ) : featuredProposals.length > 0 ? (
          <div className="proposal-grid">
            {featuredProposals.map((proposal) => (
              <ProposalCard key={proposal.id} proposal={proposal} onUpdate={loadProposals} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p>No active proposals right now.</p>
            <Link to="/creators" className="text-accent">Create the first BOT Chain vote.</Link>
          </div>
        )}
      </section>

      <section className="how-it-works">
        <h3>How Private EVM Voting Works</h3>
        <div className="steps-row">
          {steps.map((step, i) => (
            <div key={step.label} className="step-item">
              <div className="step-num">{i + 1}</div>
              <h4>{step.label}</h4>
              <p>{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="footer">
        Powered by <strong>BOT Chain</strong> · <Link to="/results">Verified Results</Link>
      </div>
    </>
  );
}
