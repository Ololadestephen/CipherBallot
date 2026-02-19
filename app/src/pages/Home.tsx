import { Link } from "react-router-dom";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as anchor from "@coral-xyz/anchor";
import { fetchProposals, type ProposalView } from "../lib/proposals";
import { ProposalCard } from "../components/ProposalCard";

const steps = [
  { label: "Connect", desc: "Link your wallet" },
  { label: "Encrypt", desc: "Vote with privacy" },
  { label: "Tally", desc: "Compute securely" },
  { label: "Reveal", desc: "Verify results" },
];

export default function Home() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [proposals, setProposals] = useState<ProposalView[]>([]);
  const [loading, setLoading] = useState(true);

  // We need a provider for the ProposalCard (even if just for view, it enables voting)
  const provider = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) return null;
    return new anchor.AnchorProvider(connection, wallet as anchor.Wallet, { commitment: "confirmed" });
  }, [connection, wallet]);

  const loadProposals = useCallback(async () => {
    try {
      setLoading(true);
      const rows = await fetchProposals(connection);
      setProposals(rows);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    loadProposals();
  }, [loadProposals]);

  const totalVotes = useMemo(() => proposals.reduce((sum, p) => sum + p.votesCast, 0), [proposals]);

  // Get top 3 active proposals, or just top 3 newest
  const featuredProposals = useMemo(() => {
    return [...proposals]
      .sort((a, b) => b.startTs - a.startTs)
      .filter(p => p.status === "Active")
      .slice(0, 3);
  }, [proposals]);

  return (
    <>
      <section className="home-hero">
        <div className="hero-content">
          <span className="hero-badge">Confidential Governance v1.0</span>
          <h1 className="hero-title">
            Your Vote, <span className="text-gradient">Encrypted.</span><br />
            Your Voice, <span className="text-white">Counted.</span>
          </h1>
          <p className="hero-copy">
            The first governance platform on Solana powered by Arcium's confidential computing.
            Vote without revealing your choice until the tally is complete.
          </p>
          <div className="home-hero-actions">
            <Link className="cta" to="/voters">
              Vote Now
            </Link>
            <Link className="button-ghost" to="/creators">
              Create Proposal
            </Link>
          </div>
        </div>
      </section>

      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">Total Volume</span>
          <span className="stat-value">{totalVotes.toLocaleString()}</span>
          <span className="stat-desc">Encrypted Ballots Cast</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Active Governance</span>
          <span className="stat-value">{proposals.length}</span>
          <span className="stat-desc">On-Chain Proposals</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Privacy Level</span>
          <span className="stat-value text-gradient">Maximum</span>
          <span className="stat-desc">Zero-Knowledge / MPC</span>
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
            {featuredProposals.map(p => (
              <ProposalCard key={p.address} proposal={p} provider={provider} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p>No active proposals right now.</p>
            <Link to="/creators" className="text-accent">Be the first to create one!</Link>
          </div>
        )}
      </section>

      <section className="how-it-works">
        <h3>How Confidential Voting Works</h3>
        <div className="steps-row">
          {steps.map((step, i) => (
            <div key={i} className="step-item">
              <div className="step-num">{i + 1}</div>
              <h4>{step.label}</h4>
              <p>{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="footer">
        Powered by <strong>Solana</strong> + <strong>Arcium</strong> ·
        <Link to="/results">Verified Results</Link>
      </div>
    </>
  );
}
