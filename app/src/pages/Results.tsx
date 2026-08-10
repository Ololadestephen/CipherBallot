import { ArrowLeft, Download, FileCheck2, ShieldCheck, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  approveThresholdTally,
  checkCommitteeStatus,
  explorerAddress,
  fetchProposal,
  fetchProposals,
  finalizeProposal,
  friendlyEvmError,
  formatDateTime,
  prepareThresholdTally,
  publishTallyTranscript,
  shortAddress,
  type PreparedThresholdTally,
  type ProposalView,
  useEvmWallet
} from "../lib/evm";
import { ResultCard } from "../components/ResultCard";
import { PageHeader } from "../components/PageHeader";

export default function Results() {
  const wallet = useEvmWallet();
  const [searchParams] = useSearchParams();
  const proposalQuery = searchParams.get("proposal");
  const parsedSelectedId = proposalQuery && /^[1-9][0-9]*$/.test(proposalQuery) ? Number(proposalQuery) : null;
  const selectedId = parsedSelectedId && Number.isSafeInteger(parsedSelectedId) ? parsedSelectedId : null;

  const [rows, setRows] = useState<ProposalView[]>([]);
  const [selected, setSelected] = useState<ProposalView | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [committeeStatus, setCommitteeStatus] = useState({ isMember: false, hasApproved: false });
  const [tallyRaw, setTallyRaw] = useState("");
  const [tallyURI, setTallyURI] = useState("");
  const [tallyProofHash, setTallyProofHash] = useState("");
  const [tallySecret, setTallySecret] = useState("");
  const [preparedTally, setPreparedTally] = useState<PreparedThresholdTally | null>(null);
  const [preparingTally, setPreparingTally] = useState(false);
  const [publishingTally, setPublishingTally] = useState(false);

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

  useEffect(() => {
    setPreparedTally(null);
    setTallySecret("");
  }, [selectedId]);

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
      setMessage(friendlyEvmError(err, "Finalization failed."));
    }
  };

  const handleApproveThresholdTally = async () => {
    if (!selected) return;
    const tallyTokens = tallyRaw
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (tallyTokens.length !== selected.options.length || tallyTokens.some((item) => !/^(0|[1-9][0-9]*)$/.test(item))) {
      return setMessage(`Enter ${selected.options.length} non-negative tally numbers in option order.`);
    }
    const tally = tallyTokens.map((item) => BigInt(item));
    if (tally.reduce((sum, item) => sum + item, 0n) > BigInt(selected.votesCast)) {
      return setMessage("The tally total cannot exceed the number of submitted ballots.");
    }
    if (!tallyURI.trim() || new TextEncoder().encode(tallyURI.trim()).length > 512) {
      return setMessage("Add a tally transcript URI no longer than 512 UTF-8 bytes.");
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(tallyProofHash.trim()) || /^0x0{64}$/i.test(tallyProofHash.trim())) {
      return setMessage("Add a non-zero 32-byte tally proof hash.");
    }
    if (!tallySecret.trim()) return setMessage("Enter the committee tally secret.");

    try {
      setMessage("Approving threshold tally...");
      const contract = await wallet.getSignerContract();
      await approveThresholdTally(contract, selected.id, tally, tallyURI.trim(), tallyProofHash.trim(), tallySecret.trim());
      setTallySecret("");
      setMessage("Threshold tally approval recorded.");
      await loadResults(false);
    } catch (err) {
      setMessage(friendlyEvmError(err, "Tally approval failed."));
    }
  };

  const handleRecoveryKit = async (file: File | undefined) => {
    if (!selected || !file) return;
    if (file.size > 32_768) return setMessage("Recovery kit exceeds the 32 KB safety limit.");
    setPreparingTally(true);
    setPreparedTally(null);
    setMessage("Validating recovery kit and reconstructing the on-chain ballot set...");
    try {
      const kit = JSON.parse(await file.text()) as unknown;
      const prepared = await prepareThresholdTally(selected, kit);
      setPreparedTally(prepared);
      setTallyRaw(prepared.transcript.finalTally.join(","));
      setTallyProofHash(prepared.transcriptHash);
      setTallySecret(prepared.tallySecret);
      setMessage(`Tally prepared locally from ${prepared.transcript.ballotCount} authenticated ballot${prepared.transcript.ballotCount === 1 ? "" : "s"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to prepare the tally from this recovery kit.");
    } finally {
      setPreparingTally(false);
    }
  };

  const downloadTranscript = () => {
    if (!selected || !preparedTally) return;
    const blob = new Blob([preparedTally.transcriptJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cipherballot-proposal-${selected.id}-tally-${preparedTally.transcriptHash.slice(2, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handlePublishAndApprove = async () => {
    if (!selected || !preparedTally) return;
    setPublishingTally(true);
    try {
      setMessage("Publishing the public tally transcript...");
      const uri = await publishTallyTranscript(preparedTally);
      setTallyURI(uri);
      setMessage("Confirm the committee tally approval in your wallet...");
      const contract = await wallet.getSignerContract();
      await approveThresholdTally(
        contract,
        selected.id,
        preparedTally.finalTally,
        uri,
        preparedTally.transcriptHash,
        preparedTally.tallySecret
      );
      setTallySecret("");
      setPreparedTally(null);
      setMessage("Tally evidence published and committee approval recorded.");
      await loadResults(false);
    } catch (error) {
      setMessage(friendlyEvmError(error, error instanceof Error ? error.message : "Tally publication or approval failed."));
    } finally {
      setPublishingTally(false);
    }
  };

  if (selected && selectedId) {
    const unrevealed = Math.max(0, selected.votesCast - selected.revealCount);

    return (
      <div className="results-detail-container">
        <Link to="/results" className="app-back-link"><ArrowLeft size={15} /> All results</Link>

        <PageHeader
          title={selected.title}
          description="Final outcome, committee approvals, and contract evidence for this governance decision."
          status={<span className={`pill status-${selected.status.toLowerCase()}`}>{selected.status}</span>}
        />

        <div className="result-outcome-panel">
          <div className="detail-header">
            <div className="meta-row">
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
          <div className="committee-operator-panel">
            <div className="tally-workspace-heading">
              <div>
                <strong>Committee tally workspace</strong>
                <p>Recover the ballot set locally after the on-chain deadline, review the result, and approve it.</p>
              </div>
              <span className="tally-deadline-state"><ShieldCheck size={15} /> Voting closed</span>
            </div>
            {committeeStatus.isMember ? (
              committeeStatus.hasApproved ? (
                <div className="tally-complete-state"><FileCheck2 size={18} /><span>Your wallet has already approved this proposal's tally.</span></div>
              ) : (
                <>
                  {!preparedTally ? (
                    <div className="tally-import-zone">
                      <Upload size={20} />
                      <div>
                        <strong>{preparingTally ? "Reconstructing tally..." : "Import proposal recovery kit"}</strong>
                        <p>The election key is used only in this browser tab and is never uploaded or saved.</p>
                      </div>
                      <label className={`cta tally-file-command ${preparingTally ? "disabled" : ""}`}>
                        <Upload size={15} /> Choose recovery kit
                        <input
                          type="file"
                          accept="application/json,.json"
                          disabled={preparingTally}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            void handleRecoveryKit(file);
                          }}
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="prepared-tally">
                      <div className="prepared-tally-status">
                        <FileCheck2 size={19} />
                        <div><strong>Tally package prepared</strong><span>{preparedTally.transcript.ballotCount} authenticated ballot{preparedTally.transcript.ballotCount === 1 ? "" : "s"} reconstructed from BOT Chain.</span></div>
                      </div>
                      <div className="prepared-tally-options">
                        {selected.options.map((option, index) => (
                          <div key={option}><span>{option}</span><strong>{preparedTally.transcript.finalTally[index]}</strong></div>
                        ))}
                      </div>
                      <dl className="prepared-tally-evidence">
                        <div><dt>Transcript hash</dt><dd>{shortAddress(preparedTally.transcriptHash)}</dd></div>
                        <div><dt>Contract ballots</dt><dd>{selected.votesCast}</dd></div>
                        <div><dt>Recovered ballots</dt><dd>{preparedTally.transcript.ballotCount}</dd></div>
                      </dl>
                      <p className="tally-boundary-note">This confirms evidence integrity and local reconstruction. The current contract does not verify a zero-knowledge proof of decryption correctness.</p>
                      <div className="prepared-tally-actions">
                        <button className="cta" onClick={handlePublishAndApprove} disabled={publishingTally}>
                          <ShieldCheck size={15} /> {publishingTally ? "Publishing tally..." : "Publish and approve result"}
                        </button>
                        <button className="secondary-cta" onClick={downloadTranscript} disabled={publishingTally}>
                          <Download size={15} /> Download transcript
                        </button>
                        <button className="text-command" onClick={() => { setPreparedTally(null); setTallySecret(""); }} disabled={publishingTally}>
                          Use another kit
                        </button>
                      </div>
                    </div>
                  )}

                  <details className="manual-tally-details">
                    <summary>Advanced manual approval</summary>
                    <p>Use only when the automated transcript publisher is unavailable.</p>
                    <label className="input-label">
                      Tally values
                      <input className="input" value={tallyRaw} onChange={(event) => setTallyRaw(event.target.value)} placeholder={selected.options.map(() => "0").join(", ")} />
                    </label>
                    <label className="input-label">
                      Tally transcript URI
                      <input className="input" value={tallyURI} onChange={(event) => setTallyURI(event.target.value)} placeholder="ipfs://... or https://..." />
                    </label>
                    <label className="input-label">
                      Transcript hash
                      <input className="input" value={tallyProofHash} onChange={(event) => setTallyProofHash(event.target.value)} placeholder="0x..." />
                    </label>
                    <label className="input-label">
                      Committee tally secret
                      <input className="input" type="password" value={tallySecret} onChange={(event) => setTallySecret(event.target.value)} placeholder="0x..." />
                    </label>
                    <button className="secondary-cta" onClick={handleApproveThresholdTally}>Approve manual package</button>
                  </details>
                </>
              )
            ) : (
              <p>Connect a committee wallet to approve the threshold tally.</p>
            )}
          </div>
        )}

        <div className="result-evidence-grid">
          <div className="result-evidence-block">
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
          <div className="result-evidence-block">
            <strong>{selected.privacyMode === "SecretSealed" ? "Threshold Accounting" : "Commit-Reveal Accounting"}</strong>
            <p>{selected.privacyMode === "SecretSealed" ? "Private ballots" : "Total commitments"}: {selected.votesCast}</p>
            <p>{selected.privacyMode === "SecretSealed" ? "Tally approvals" : "Verified reveals"}: {selected.privacyMode === "SecretSealed" ? `${selected.tallyApprovalCount}/${selected.threshold}` : selected.revealCount}</p>
            <p>{selected.privacyMode === "SecretSealed" ? "Tally hash" : "Unrevealed commitments"}: {selected.privacyMode === "SecretSealed" ? selected.tallyHash.slice(0, 10) : unrevealed}</p>
          </div>
          <div className="result-evidence-block">
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
    <section className="app-page results-overview">
      <PageHeader title="Results ledger" description="Review pending tallies and finalized outcomes recorded by the CipherBallot contract on BOT Chain." />

      {loading ? (
        <div className="loading-state app-loading-state">Syncing with BOT Chain...</div>
      ) : rows.length === 0 ? (
        <div className="app-empty-state"><strong>No results found</strong><p>Create a proposal and collect ballots before an outcome can appear here.</p></div>
      ) : (
        <div className="results-ledger">
          {rows.map((proposal) => (
            <ResultCard key={proposal.id} proposal={proposal} />
          ))}
        </div>
      )}
    </section>
  );
}
