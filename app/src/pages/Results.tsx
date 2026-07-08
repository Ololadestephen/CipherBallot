import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  approveThresholdTally,
  checkCommitteeStatus,
  explorerAddress,
  fetchProposal,
  fetchProposals,
  finalizeProposal,
  formatDateTime,
  shortAddress,
  type ProposalView,
  useEvmWallet
} from "../lib/evm";
import { ResultCard } from "../components/ResultCard";

export default function Results() {
  const wallet = useEvmWallet();
  const [searchParams] = useSearchParams();
  const proposalQuery = searchParams.get("proposal");
  const selectedId = proposalQuery ? Number(proposalQuery) : null;

  const [rows, setRows] = useState<ProposalView[]>([]);
  const [selected, setSelected] = useState<ProposalView | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [committeeStatus, setCommitteeStatus] = useState({ isMember: false, hasApproved: false });
  const [tallyRaw, setTallyRaw] = useState("");
  const [tallyURI, setTallyURI] = useState("");
  const [tallyProofHash, setTallyProofHash] = useState("");
  const [tallySecret, setTallySecret] = useState("");

  const loadResults = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      if (selectedId) {
        const proposal = await fetchProposal(selectedId);
        setSelected(proposal);
        setRows(proposal ? [proposal] : []);
      } else {
        const all = await fetchProposals();
        setRows(all);
        setSelected(null);
      }
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void loadResults(true);
    const interval = window.setInterval(() => void loadResults(false), 60000);
    return () => window.clearInterval(interval);
  }, [loadResults]);

  useEffect(() => {
    if (!selectedId || !wallet.account) {
      setCommitteeStatus({ isMember: false, hasApproved: false });
      return;
    }
    void checkCommitteeStatus(selectedId, wallet.account).then(setCommitteeStatus);
  }, [selectedId, wallet.account, rows]);

  const totalVotes = useMemo(() => selected?.finalTally.reduce((sum, item) => sum + item, 0) ?? 0, [selected]);

  const handleFinalize = async () => {
    if (!selected) return;
    try {
      setMessage("Finalizing proposal...");
      const contract = await wallet.getSignerContract();
      await finalizeProposal(contract, selected.id);
      setMessage("Proposal finalized.");
      await loadResults(false);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Finalization failed");
    }
  };

  const handleApproveThresholdTally = async () => {
    if (!selected) return;
    const tally = tallyRaw
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => Number(item));

    if (tally.length !== selected.options.length || tally.some((item) => !Number.isInteger(item) || item < 0)) {
      return setMessage(`Enter ${selected.options.length} non-negative tally numbers in option order.`);
    }
    if (!tallyURI.trim()) return setMessage("Add a tally transcript URI.");
    if (!/^0x[0-9a-fA-F]{64}$/.test(tallyProofHash.trim())) {
      return setMessage("Add a 32-byte tally proof hash.");
    }
    if (!tallySecret.trim()) return setMessage("Enter the committee tally secret.");

    try {
      setMessage("Approving threshold tally...");
      const contract = await wallet.getSignerContract();
      await approveThresholdTally(contract, selected.id, tally, tallyURI.trim(), tallyProofHash.trim(), tallySecret.trim());
      setMessage("Threshold tally approval recorded.");
      await loadResults(false);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Tally approval failed");
    }
  };

  if (selected && selectedId) {
    const unrevealed = Math.max(0, selected.votesCast - selected.revealCount);

    return (
      <div className="results-detail-container">
        <Link to="/results" className="back-link">← Back to All Results</Link>

        <div className="proposal-card detail-card" style={{ marginTop: "20px" }}>
          <div className="detail-header">
            <h1 className="detail-title">{selected.title}</h1>
            <div className="meta-row">
              <span className={`pill status-${selected.status.toLowerCase()}`}>{selected.status}</span>
              <span className="metadata-item">
                {selected.privacyMode === "SecretSealed" ? `${selected.votesCast} private ballots` : `${selected.votesCast} commitments`}
              </span>
              <span className="metadata-item">
                {selected.privacyMode === "SecretSealed" ? `${selected.tallyApprovalCount}/${selected.threshold} approvals` : `${selected.revealCount} reveals`}
              </span>
            </div>
          </div>

          <div className="results-chart-section">
            {selected.finalized ? (
              selected.options.map((option, index) => {
                const votes = selected.finalTally[index] || 0;
                const percentage = totalVotes > 0 ? (votes / totalVotes) * 100 : 0;
                return (
                  <div key={option} className="chart-row">
                    <div className="chart-labels">
                      <span className="opt-name">{option}</span>
                      <span className="opt-val">{votes} ({percentage.toFixed(1)}%)</span>
                    </div>
                    <div className="chart-track">
                      <div className="chart-fill" style={{ width: `${percentage}%` }} />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="pending-state-box">
                <h3>Final Tally Not Published</h3>
                <p>
                  {selected.privacyMode === "SecretSealed"
                    ? "Private ballots are waiting for enough committee members to approve the same secret-sealed tally."
                    : "Votes are hidden commitments until voters reveal after the deadline."}
                </p>
                {selected.privacyMode === "CommitReveal" && selected.status === "Reveal" && (
                  <button className="cta" onClick={handleFinalize}>
                    Finalize Proposal
                  </button>
                )}
              </div>
            )}
          </div>

          {message && <div className="feedback-msg">{message}</div>}
        </div>

        {selected.privacyMode === "SecretSealed" && selected.status === "Tallying" && (
          <div className="proposal-card detail-card" style={{ marginTop: "20px" }}>
            <strong>Committee Tally Approval</strong>
            {committeeStatus.isMember ? (
              <>
                <p>
                  {committeeStatus.hasApproved
                    ? "Your wallet has already approved the current tally."
                    : "Submit the tally in option order after checking the committee transcript."}
                </p>
                <label className="input-label">
                  Tally values
                  <input
                    className="input"
                    value={tallyRaw}
                    onChange={(event) => setTallyRaw(event.target.value)}
                    placeholder={selected.options.map(() => "0").join(", ")}
                    disabled={committeeStatus.hasApproved}
                  />
                </label>
                <label className="input-label">
                  Tally transcript URI
                  <input
                    className="input"
                    value={tallyURI}
                    onChange={(event) => setTallyURI(event.target.value)}
                    placeholder="ipfs://..."
                    disabled={committeeStatus.hasApproved}
                  />
                </label>
                <label className="input-label">
                  Tally proof hash
                  <input
                    className="input"
                    value={tallyProofHash}
                    onChange={(event) => setTallyProofHash(event.target.value)}
                    placeholder="0x..."
                    disabled={committeeStatus.hasApproved}
                  />
                </label>
                <label className="input-label">
                  Committee tally secret
                  <input
                    className="input"
                    type="password"
                    value={tallySecret}
                    onChange={(event) => setTallySecret(event.target.value)}
                    placeholder="Shared tally secret"
                    disabled={committeeStatus.hasApproved}
                  />
                </label>
                <button className="cta" onClick={handleApproveThresholdTally} disabled={committeeStatus.hasApproved}>
                  Approve Tally
                </button>
              </>
            ) : (
              <p>Connect a committee wallet to approve the threshold tally.</p>
            )}
          </div>
        )}

        <div className="grid" style={{ marginTop: "24px" }}>
          <div className="card">
            <strong>On-Chain Verification</strong>
            <p>Proposal ID: #{selected.id}</p>
            <p>
              Contract:{" "}
              <a href={explorerAddress(selected.address)} target="_blank" rel="noreferrer">
                {shortAddress(selected.address)}
              </a>
            </p>
            <p>Status: {selected.finalized ? "Finalized" : "Open for reveal/finalization"}</p>
          </div>
          <div className="card">
            <strong>{selected.privacyMode === "SecretSealed" ? "Threshold Accounting" : "Commit-Reveal Accounting"}</strong>
            <p>{selected.privacyMode === "SecretSealed" ? "Private ballots" : "Total commitments"}: {selected.votesCast}</p>
            <p>{selected.privacyMode === "SecretSealed" ? "Tally approvals" : "Verified reveals"}: {selected.privacyMode === "SecretSealed" ? `${selected.tallyApprovalCount}/${selected.threshold}` : selected.revealCount}</p>
            <p>{selected.privacyMode === "SecretSealed" ? "Tally hash" : "Unrevealed commitments"}: {selected.privacyMode === "SecretSealed" ? selected.tallyHash.slice(0, 10) : unrevealed}</p>
          </div>
          <div className="card">
            <strong>Governance Rules</strong>
            <p>{selected.allowlistEnabled ? `${selected.allowedVoterCount} allowlisted voters` : "Public proposal"}</p>
            <p>Voting ended: {formatDateTime(selected.endTs)}</p>
            <p>
              {selected.privacyMode === "SecretSealed"
                ? `Committee: ${selected.threshold} of ${selected.committeeMemberCount}`
                : `Reveal deadline: ${formatDateTime(selected.revealDeadline)}`}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="results-overview">
      <div className="voters-header">
        <div>
          <h3 className="section-title">Election Results</h3>
          <p className="hero-copy" style={{ fontSize: "16px", margin: 0, opacity: 0.7 }}>
            Outcomes finalized by the CipherBallot contract on BOT Chain.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="loading-state">Syncing with BOT Chain...</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">No proposals found.</div>
      ) : (
        <div className="proposal-grid">
          {rows.map((proposal) => (
            <ResultCard key={proposal.id} proposal={proposal} />
          ))}
        </div>
      )}
    </div>
  );
}
