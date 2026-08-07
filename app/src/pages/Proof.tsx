import { Activity, Box, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader";
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
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadStats = async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      setError("");
      setStats(await fetchProofStats());
      setLastUpdated(new Date());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load BOT Chain proof data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadStats(true);
    const id = window.setInterval(() => void loadStats(false), 10_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section className="app-page proof-page">
      <PageHeader
        title="Protocol proof"
        description="A direct RPC view of the deployed contract, proposal lifecycle, encrypted participation, and committee approvals."
        status={<div className="network-indicator ready"><span /> RPC online</div>}
        actions={<button className="icon-button" title="Refresh proof" aria-label="Refresh proof" onClick={() => void loadStats(false)} disabled={refreshing}><RefreshCw size={16} className={refreshing ? "spin" : ""} /></button>}
      />

      {!CONTRACT_ADDRESS && <div className="feedback-msg error">Set VITE_CIPHERBALLOT_CONTRACT_ADDRESS to enable proof data.</div>}

      {loading ? (
        <div className="loading-state app-loading-state">Reading contract evidence...</div>
      ) : error ? (
        <div className="feedback-msg error">{error}</div>
      ) : stats ? (
        <>
          <div className="proof-status-strip">
            <div><Activity size={17} /><span>Network</span><strong>{BOT_CHAIN.name}</strong><small>Chain ID {stats.chainId}</small></div>
            <div><Box size={17} /><span>Latest block</span><strong>{stats.latestBlock.toLocaleString()}</strong><small>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Live RPC"}</small></div>
            <div><ShieldCheck size={17} /><span>Verified contract</span><strong>{shortAddress(stats.contractAddress)}</strong><a href={explorerAddress(stats.contractAddress)} target="_blank" rel="noreferrer">Explorer <ExternalLink size={12} /></a></div>
          </div>

          <section className="proof-ledger" aria-labelledby="proof-ledger-title">
            <div className="proof-ledger-heading"><div><p>Contract state</p><h2 id="proof-ledger-title">Verification ledger</h2></div><span>Source: {BOT_CHAIN.rpcUrl}</span></div>
            <dl>
              <div><dt>Total proposals</dt><dd>{stats.proposalCount}</dd><span>Created by the deployed contract</span></div>
              <div><dt>Threshold proposals</dt><dd>{stats.thresholdProposalCount}</dd><span>Secret-sealed privacy mode</span></div>
              <div><dt>Private ballot records</dt><dd>{stats.totalCommitments}</dd><span>Encrypted submissions and commitments</span></div>
              <div><dt>Tally approvals</dt><dd>{stats.totalTallyApprovals}</dd><span>Committee approvals recorded on-chain</span></div>
            </dl>
          </section>

          <section className="proof-lifecycle" aria-labelledby="proof-lifecycle-title">
            <div><p>Proposal lifecycle</p><h2 id="proof-lifecycle-title">Current state distribution</h2></div>
            <div className="proof-lifecycle-grid">
              <span><strong>{stats.activeCount}</strong>Active</span>
              <span><strong>{stats.revealCount}</strong>Reveal</span>
              <span><strong>{stats.tallyingCount}</strong>Tallying</span>
              <span className="finalized"><strong>{stats.finalizedCount}</strong>Finalized</span>
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
