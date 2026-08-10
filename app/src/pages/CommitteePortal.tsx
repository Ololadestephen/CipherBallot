import { CheckCircle2, Copy, FileCheck2, KeyRound, RefreshCw, ShieldCheck, Upload, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import {
  confirmCommitteeReadiness,
  fetchCommitteePortalStatus,
  releaseCommitteeHandoff,
  retrieveCommitteeHandoff,
  revokeCommitteeHandoff,
  type CommitteePortalStatus
} from "../lib/committeeApi";
import {
  decryptCommitteeHandoff,
  encryptCommitteeHandoff,
  generateCommitteeHandoffKey,
  normalizeCommitteeHandoffKey
} from "../lib/committeeHandoff";
import {
  approveThresholdTally,
  checkCommitteeStatus,
  fetchProposals,
  friendlyEvmError,
  formatDateTime,
  prepareThresholdTally,
  publishTallyTranscript,
  shortAddress,
  type PreparedThresholdTally,
  type ProposalView,
  useEvmWallet
} from "../lib/evm";
import { committeePortalPath, proposalCode, proposalMatchesCode } from "../lib/proposalCode";

function handoffKeyFromHash() {
  const value = new URLSearchParams(window.location.hash.slice(1)).get("handoff") || "";
  if (!value) return "";
  try {
    return normalizeCommitteeHandoffKey(value);
  } catch {
    return "";
  }
}

export default function CommitteePortal() {
  const { code = "" } = useParams();
  const wallet = useEvmWallet();
  const [proposal, setProposal] = useState<ProposalView | null>(null);
  const [portalStatus, setPortalStatus] = useState<CommitteePortalStatus | null>(null);
  const [committeeStatus, setCommitteeStatus] = useState({ isMember: false, hasApproved: false });
  const [handoffKey, setHandoffKey] = useState(handoffKeyFromHash);
  const [preparedTally, setPreparedTally] = useState<PreparedThresholdTally | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const proposals = await fetchProposals();
    const matches = proposals.filter((item) => proposalMatchesCode(item, code));
    if (matches.length > 1) throw new Error("This short proposal code is ambiguous. Use the canonical proposal link instead.");
    const selected = matches[0] || null;
    setProposal(selected);
    if (selected) setPortalStatus(await fetchCommitteePortalStatus(selected.id));
    setLoading(false);
  }, [code]);

  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    void load().catch((error) => {
      setMessage(error instanceof Error ? error.message : "Unable to load the committee portal.");
      setLoading(false);
    });
  }, [load]);

  useEffect(() => {
    if (!proposal || !wallet.account) {
      setCommitteeStatus({ isMember: false, hasApproved: false });
      return;
    }
    void checkCommitteeStatus(proposal.id, wallet.account).then(setCommitteeStatus);
  }, [proposal, wallet.account, portalStatus]);

  const isCreator = Boolean(proposal && wallet.account && proposal.creator.toLowerCase() === wallet.account.toLowerCase());
  const isReady = Boolean(wallet.account && portalStatus?.ready.some((item) => item.address.toLowerCase() === wallet.account.toLowerCase()));
  const isRetrieved = Boolean(wallet.account && portalStatus?.retrieved.some((item) => item.address.toLowerCase() === wallet.account.toLowerCase()));
  const votingClosed = proposal?.status === "Tallying" || proposal?.status === "Finalized";
  const portalUrl = useMemo(() => {
    if (!proposal || !handoffKey) return "";
    return `${window.location.origin}${committeePortalPath(proposal.id)}#handoff=${handoffKey.slice(2)}`;
  }, [proposal, handoffKey]);

  const refreshStatus = async () => {
    if (!proposal) return;
    setPortalStatus(await fetchCommitteePortalStatus(proposal.id));
  };

  const confirmReadiness = async () => {
    if (!proposal || !wallet.account) return;
    setWorking(true);
    try {
      setMessage("Sign the readiness confirmation in your wallet...");
      await confirmCommitteeReadiness(proposal.id, wallet.account);
      await refreshStatus();
      setMessage("Committee readiness confirmed.");
    } catch (error) {
      setMessage(friendlyEvmError(error, "Unable to confirm committee readiness."));
    } finally {
      setWorking(false);
    }
  };

  const releaseHandoff = async (file: File | undefined) => {
    if (!proposal || !wallet.account || !file) return;
    if (file.size > 32_768) return setMessage("Recovery kit exceeds the 32 KB safety limit.");
    setWorking(true);
    try {
      setMessage("Validating the recovery kit locally...");
      const recoveryKitJson = await file.text();
      const recoveryKit = JSON.parse(recoveryKitJson) as Record<string, unknown>;
      const kitHandoffKey = typeof recoveryKit.committeeHandoffKey === "string"
        ? normalizeCommitteeHandoffKey(recoveryKit.committeeHandoffKey)
        : "";
      const activeKey = kitHandoffKey || handoffKey || generateCommitteeHandoffKey();
      if (handoffKey && kitHandoffKey && handoffKey !== kitHandoffKey) {
        throw new Error("The recovery kit and committee portal link use different handoff keys.");
      }
      await prepareThresholdTally(proposal, recoveryKit);
      const encryptedPackage = await encryptCommitteeHandoff(proposal.id, recoveryKitJson, activeKey);
      setMessage("Sign to release the encrypted package to committee wallets...");
      await releaseCommitteeHandoff(proposal.id, wallet.account, encryptedPackage);
      setHandoffKey(activeKey);
      await refreshStatus();
      setMessage("Encrypted tally access released. Committee members can now use the shared portal link.");
    } catch (error) {
      setMessage(friendlyEvmError(error, error instanceof Error ? error.message : "Unable to release the committee package."));
    } finally {
      setWorking(false);
    }
  };

  const unlockHandoff = async () => {
    if (!proposal || !wallet.account) return;
    if (!handoffKey) return setMessage("Open the original committee portal link to unlock the released package.");
    setWorking(true);
    try {
      setMessage("Authenticate your committee wallet to retrieve the encrypted package...");
      const response = await retrieveCommitteeHandoff(proposal.id, wallet.account);
      const recoveryKitJson = await decryptCommitteeHandoff(proposal.id, response.package, handoffKey);
      const recoveryKit = JSON.parse(recoveryKitJson) as unknown;
      setMessage("Reconstructing and verifying the on-chain ballot set locally...");
      setPreparedTally(await prepareThresholdTally(proposal, recoveryKit));
      await refreshStatus();
      setMessage("Tally reconstructed locally. Review every option before approving.");
    } catch (error) {
      setMessage(friendlyEvmError(error, error instanceof Error ? error.message : "Unable to unlock the committee package."));
    } finally {
      setWorking(false);
    }
  };

  const publishAndApprove = async () => {
    if (!proposal || !preparedTally) return;
    setWorking(true);
    try {
      setMessage("Publishing the deterministic tally transcript...");
      const uri = await publishTallyTranscript(preparedTally);
      setMessage("Confirm the on-chain committee approval...");
      const contract = await wallet.getSignerContract();
      await approveThresholdTally(
        contract,
        proposal.id,
        preparedTally.finalTally,
        uri,
        preparedTally.transcriptHash,
        preparedTally.tallySecret
      );
      setPreparedTally(null);
      await load();
      setMessage("Committee approval recorded on BOT Chain.");
    } catch (error) {
      setMessage(friendlyEvmError(error, "Unable to publish and approve this tally."));
    } finally {
      setWorking(false);
    }
  };

  const revokeHandoff = async () => {
    if (!proposal || !wallet.account) return;
    setWorking(true);
    try {
      setMessage("Sign to revoke the currently stored encrypted package...");
      await revokeCommitteeHandoff(proposal.id, wallet.account);
      await refreshStatus();
      setMessage("Committee package revoked. You can release a replacement from the original recovery kit.");
    } catch (error) {
      setMessage(friendlyEvmError(error, "Unable to revoke the committee package."));
    } finally {
      setWorking(false);
    }
  };

  if (loading) return <div className="loading-state app-loading-state">Loading committee portal...</div>;
  if (!proposal) return <div className="app-empty-state"><strong>Committee portal not found</strong><p>The proposal code is invalid for this deployment.</p><Link to="/voters">View proposals</Link></div>;

  return (
    <section className="app-page committee-portal-page">
      <PageHeader
        title={proposal.title}
        description={`${proposalCode(proposal.id)} committee coordination and post-deadline tally access.`}
        status={<span className={`pill status-${proposal.status.toLowerCase()}`}>{proposal.status}</span>}
      />

      <div className="committee-summary-band">
        <div><Users size={18} /><span><strong>{portalStatus?.ready.length || 0} of {proposal.committeeMemberCount}</strong><small>Members ready</small></span></div>
        <div><KeyRound size={18} /><span><strong>{portalStatus?.handoff.available ? "Released" : "Offline"}</strong><small>Tally access</small></span></div>
        <div><FileCheck2 size={18} /><span><strong>{proposal.tallyApprovalCount} of {proposal.threshold}</strong><small>Approvals recorded</small></span></div>
        <button className="icon-button" title="Refresh committee status" aria-label="Refresh committee status" onClick={() => void refreshStatus()}><RefreshCw size={16} /></button>
      </div>

      {!wallet.connected ? (
        <div className="committee-action-panel"><ShieldCheck size={22} /><div><strong>Connect a committee or creator wallet</strong><p>The portal reads your role directly from the deployed contract.</p></div></div>
      ) : (
        <div className="committee-portal-grid">
          {committeeStatus.isMember && (
            <section className="committee-role-section">
              <div className="committee-section-heading"><span>Committee member</span><strong>{shortAddress(wallet.account)}</strong></div>
              {!isReady ? (
                <div className="committee-action-panel"><CheckCircle2 size={22} /><div><strong>Confirm readiness</strong><p>One wallet signature confirms that you can return after voting closes. It does not submit a transaction.</p></div><button className="cta" disabled={working} onClick={() => void confirmReadiness()}>Confirm readiness</button></div>
              ) : (
                <div className="committee-complete-line"><CheckCircle2 size={17} /><span>Readiness confirmed</span></div>
              )}

              {votingClosed && !proposal.finalized && !committeeStatus.hasApproved && (
                !preparedTally ? (
                  <div className="committee-action-panel">
                    <KeyRound size={22} />
                    <div><strong>{portalStatus?.handoff.available ? "Tally package available" : "Waiting for creator release"}</strong><p>{isRetrieved ? "This wallet previously retrieved the package. You can authenticate again safely." : "The package remains encrypted until this committee wallet authenticates."}</p></div>
                    <button className="cta" disabled={working || !portalStatus?.handoff.available} onClick={() => void unlockHandoff()}>Unlock tally</button>
                  </div>
                ) : (
                  <div className="prepared-tally committee-prepared-tally">
                    <div className="prepared-tally-status"><FileCheck2 size={19} /><div><strong>Tally reconstructed locally</strong><span>{preparedTally.transcript.ballotCount} authenticated ballots recovered from BOT Chain.</span></div></div>
                    <div className="prepared-tally-options">
                      {proposal.options.map((option, index) => <div key={option}><span>{option}</span><strong>{preparedTally.transcript.finalTally[index]}</strong></div>)}
                    </div>
                    <p className="tally-boundary-note">Confirm that the displayed result matches your independent review before signing the on-chain approval.</p>
                    <button className="cta" disabled={working} onClick={() => void publishAndApprove()}><ShieldCheck size={15} /> Publish and approve result</button>
                  </div>
                )
              )}
              {committeeStatus.hasApproved && <div className="committee-complete-line"><ShieldCheck size={17} /><span>This wallet has approved the on-chain tally.</span></div>}
            </section>
          )}

          {isCreator && (
            <section className="committee-role-section">
              <div className="committee-section-heading"><span>Proposal creator</span><strong>{shortAddress(wallet.account)}</strong></div>
              {!votingClosed ? (
                <div className="committee-action-panel"><KeyRound size={22} /><div><strong>Recovery kit remains offline</strong><p>Return after voting closes at {formatDateTime(proposal.endTs)} to release encrypted tally access.</p></div></div>
              ) : portalStatus?.handoff.available ? (
                <div className="committee-action-panel"><CheckCircle2 size={22} /><div><strong>Encrypted access released</strong><p>{portalStatus.retrieved.length} committee wallet{portalStatus.retrieved.length === 1 ? " has" : "s have"} retrieved the package.</p></div><button className="secondary-cta" disabled={working} onClick={() => void revokeHandoff()}>Revoke package</button></div>
              ) : (
                <div className="committee-action-panel">
                  <Upload size={22} />
                  <div><strong>Release tally access</strong><p>Import the original recovery-kit JSON once. Validation and encryption happen only in this browser.</p></div>
                  <label className={`cta tally-file-command ${working ? "disabled" : ""}`}><Upload size={15} /> Import and release<input type="file" accept="application/json,.json" disabled={working} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void releaseHandoff(file); }} /></label>
                </div>
              )}
              {portalUrl && (
                <button className="secondary-cta icon-command" onClick={() => void navigator.clipboard.writeText(portalUrl)}><Copy size={15} /> Copy shared committee link</button>
              )}
            </section>
          )}

          {!committeeStatus.isMember && !isCreator && (
            <div className="committee-action-panel"><ShieldCheck size={22} /><div><strong>Wallet is not assigned to this portal</strong><p>Connect the proposal creator or one of its on-chain committee wallets.</p></div></div>
          )}
        </div>
      )}

      {message && <div className="feedback-msg">{message}</div>}
      <div className="committee-portal-footer"><Link to={`/proposal/${proposal.id}`}>Open proposal</Link><Link to={`/results?proposal=${proposal.id}`}>View result record</Link></div>
    </section>
  );
}
