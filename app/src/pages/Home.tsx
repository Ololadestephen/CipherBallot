import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ProposalCard } from "../components/ProposalCard";
import {
  BOT_CHAIN,
  CONTRACT_ADDRESS,
  explorerAddress,
  fetchProposals,
  type ProposalView
} from "../lib/evm";

const agentFlow = [
  { label: "Authorize", detail: "Choose an agent, proposal scope, and expiry." },
  { label: "Discover", detail: "The agent reads eligible proposals through the API." },
  { label: "Encrypt", detail: "The ballot choice is sealed to the election public key." },
  { label: "Sign", detail: "The agent signs a replay-protected EIP-712 instruction." },
  { label: "Relay", detail: "A gas-sponsored relayer submits the ballot for the voter." }
];

const privacyPoints = [
  {
    number: "01",
    title: "Local encryption",
    detail: "The readable choice stays off-chain. Only its encrypted envelope is submitted."
  },
  {
    number: "02",
    title: "Deadline separation",
    detail: "Voting closes before the committee can approve a final tally."
  },
  {
    number: "03",
    title: "Threshold approval",
    detail: "No single committee member can finalize the encrypted outcome alone."
  }
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

  const activeProposals = useMemo(() => proposals.filter((proposal) => proposal.status === "Active"), [proposals]);
  const featuredProposals = useMemo(() => activeProposals.slice(0, 3), [activeProposals]);

  return (
    <div className="landing-page">
      <section className="landing-hero" aria-labelledby="landing-title">
        <picture className="landing-hero-media">
          <source media="(max-width: 760px)" srcSet="/images/landing/hero-cosmic-governance-mobile.webp" />
          <img
            className="landing-hero-image"
            src="/images/landing/hero-cosmic-governance.webp"
            alt="A luminous digital figure moving through a field of stars"
            width="1672"
            height="941"
            fetchPriority="high"
          />
        </picture>
        <div className="landing-hero-shade" aria-hidden="true" />
        <div className="landing-container landing-hero-inner">
          <div className="landing-hero-copy">
            <h1 id="landing-title">CipherBallot</h1>
            <p className="landing-hero-statement">Private governance for people and autonomous agents.</p>
            <p className="landing-hero-detail">
              Encrypt ballots before submission, grant agents narrowly scoped voting authority, and verify every final decision on-chain.
            </p>
            <div className="landing-actions">
              <Link className="landing-button landing-button-primary" to="/voters">Explore proposals</Link>
              <Link className="landing-button landing-button-secondary" to="/creators">Create a proposal</Link>
            </div>
          </div>

        </div>
      </section>

      {!CONTRACT_ADDRESS && (
        <div className="landing-container landing-config-error">
          Set VITE_CIPHERBALLOT_CONTRACT_ADDRESS to connect the interface to BOT Chain.
        </div>
      )}

      <section className="landing-section landing-decisions" aria-labelledby="decisions-title">
        <div className="landing-container">
          <div className="landing-section-heading">
            <div>
              <p className="landing-eyebrow">Governance in motion</p>
              <h2 id="decisions-title">Decisions happening now.</h2>
            </div>
            <div className="landing-section-aside">
              <p>Participate without exposing live voting signals to the crowd.</p>
              <Link to="/voters" className="landing-button landing-button-secondary">View all proposals</Link>
            </div>
          </div>

          {loading ? (
            <div className="landing-loading">Reading BOT Chain...</div>
          ) : featuredProposals.length > 0 ? (
            <div className="proposal-grid landing-proposal-grid">
              {featuredProposals.map((proposal) => (
                <ProposalCard key={proposal.id} proposal={proposal} onUpdate={loadProposals} />
              ))}
            </div>
          ) : (
            <div className="landing-empty-state">
              <span>No active decision is open right now.</span>
              <Link to="/creators" className="landing-button landing-button-secondary">Open the next vote</Link>
            </div>
          )}
        </div>
      </section>

      <section className="landing-section landing-agent-band" aria-labelledby="agent-title">
        <div className="landing-container landing-feature-layout">
          <figure className="landing-visual landing-agent-visual">
            <img src="/images/landing/2.jpeg" alt="A futuristic agent with a luminous orbit around its head" loading="lazy" />
            <figcaption>Delegated intelligence. Bounded authority.</figcaption>
          </figure>

          <div className="landing-feature-copy">
            <p className="landing-eyebrow landing-eyebrow-cyan">Agent access</p>
            <h2 id="agent-title">Scoped authority, not wallet custody.</h2>
            <p className="landing-lead">
              A voter can authorize an agent for one proposal or all proposals, set an expiry, and revoke access at any time. The agent never receives the voter&apos;s private key.
            </p>

            <ol className="landing-flow-list">
              {agentFlow.map((step, index) => (
                <li key={step.label}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{step.label}</strong>
                    <p>{step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="landing-actions">
              <Link className="landing-button landing-button-primary" to="/agents">Manage agent access</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section landing-privacy-band" aria-labelledby="privacy-title">
        <div className="landing-privacy-media" aria-hidden="true">
          <img src="/images/landing/encrypted-execution.webp" alt="" loading="lazy" />
        </div>
        <div className="landing-container landing-privacy-content">
          <div className="landing-privacy-heading">
            <p className="landing-eyebrow landing-eyebrow-orange">Encrypted execution</p>
            <h2 id="privacy-title">A public ballot does not need a public choice.</h2>
            <p className="landing-lead">
              CipherBallot publishes verifiable participation on BOT Chain while keeping readable ballot choices outside the voting window.
            </p>
          </div>

          <div className="landing-privacy-points">
            {privacyPoints.map((point) => (
              <article key={point.title}>
                <span>{point.number}</span>
                <h3>{point.title}</h3>
                <p>{point.detail}</p>
              </article>
            ))}
          </div>

          <p className="landing-protocol-note">
            <strong>Current V2 boundary:</strong> election keys are committee-custodied, with threshold tally approval enforced by the contract.
          </p>
        </div>
      </section>

      <section className="landing-section landing-proof-band" aria-labelledby="proof-title">
        <div className="landing-container landing-proof-layout">
          <div className="landing-proof-copy">
            <p className="landing-eyebrow landing-eyebrow-orange">Public verification</p>
            <h2 id="proof-title">Every final decision leaves evidence.</h2>
            <p className="landing-lead">
              Ballot submissions, agent attribution, replay protection, committee approvals, and final tallies resolve against one verified BOT Chain contract.
            </p>

            <dl className="landing-contract-facts">
              <div>
                <dt>Network</dt>
                <dd>{BOT_CHAIN.name}</dd>
              </div>
              <div>
                <dt>Chain ID</dt>
                <dd>{BOT_CHAIN.chainId}</dd>
              </div>
              <div>
                <dt>Contract</dt>
                <dd>{CONTRACT_ADDRESS || "Not configured"}</dd>
              </div>
            </dl>

            <div className="landing-actions">
              <Link className="landing-button landing-button-primary landing-button-orange" to="/proof">Inspect protocol proof</Link>
              {CONTRACT_ADDRESS && (
                <a className="landing-button landing-button-secondary" href={explorerAddress(CONTRACT_ADDRESS)} target="_blank" rel="noopener noreferrer">
                  Open contract explorer
                </a>
              )}
            </div>
          </div>

          <figure className="landing-visual landing-proof-visual">
            <img src="/images/landing/3.jpeg" alt="A reflective dark surface traced with orange and blue light" loading="lazy" />
            <figcaption>Transparent settlement. Private intent.</figcaption>
          </figure>
        </div>
      </section>

      <section className="landing-final-cta" aria-labelledby="final-cta-title">
        <div className="landing-container">
          <p className="landing-eyebrow">Govern without revealing the room</p>
          <h2 id="final-cta-title">Build the next private decision.</h2>
          <p>For communities, committees, and autonomous systems operating on BOT Chain.</p>
          <div className="landing-actions landing-actions-center">
            <Link className="landing-button landing-button-primary" to="/creators">Launch a vote</Link>
            <Link className="landing-button landing-button-secondary" to="/agents">Delegate to an agent</Link>
            <Link className="landing-button landing-button-secondary" to="/docs">Read documentation</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
