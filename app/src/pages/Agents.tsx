import { ExternalLink, FileCheck2, Search, ShieldCheck, ShieldOff } from "lucide-react";
import { useEffect, useState } from "react";
import { getAddress } from "ethers";
import { PageHeader } from "../components/PageHeader";
import {
  BOT_CHAIN,
  explorerTx,
  fetchAgentDelegation,
  fetchProposals,
  friendlyEvmError,
  formatDateTime,
  getPrivateAgentReceipts,
  revokeAgentDelegation,
  setAgentDelegation,
  useEvmWallet,
  type AgentDelegationView
} from "../lib/evm";

function defaultExpiry() {
  const date = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function Agents() {
  const wallet = useEvmWallet();
  const [agent, setAgent] = useState("");
  const [expiry, setExpiry] = useState(defaultExpiry());
  const [proposalId, setProposalId] = useState(0);
  const [proposalOptions, setProposalOptions] = useState<Array<{ id: number; title: string }>>([]);
  const [delegation, setDelegation] = useState<AgentDelegationView | null>(null);
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const [message, setMessage] = useState("");
  const [txHash, setTxHash] = useState("");
  const receipts = getPrivateAgentReceipts();

  useEffect(() => {
    let active = true;
    void fetchProposals()
      .then((proposals) => {
        if (active) setProposalOptions(proposals.map(({ id, title }) => ({ id, title })));
      })
      .catch(() => {
        if (active) setMessage("Proposal scopes could not be loaded. You can still authorize for all proposals.");
      });
    return () => { active = false; };
  }, []);

  const validate = () => {
    if (!wallet.connected) throw new Error("Connect your voter wallet first.");
    if (wallet.chainId !== BOT_CHAIN.chainId) throw new Error("Switch to BOT Chain before managing an agent.");
    return getAddress(agent.trim());
  };

  const loadDelegation = async () => {
    try {
      const normalizedAgent = validate();
      setStatus("sending");
      setMessage("Reading delegation from BOT Chain...");
      const next = await fetchAgentDelegation(wallet.account, normalizedAgent);
      setDelegation(next);
      setMessage(next.active ? "Active delegation found." : "No active delegation found.");
      setStatus("idle");
    } catch (error) {
      setStatus("error");
      setMessage(friendlyEvmError(error, "Unable to read delegation."));
    }
  };

  const authorize = async () => {
    try {
      const normalizedAgent = validate();
      if (proposalId !== 0 && !proposalOptions.some((proposal) => proposal.id === proposalId)) {
        throw new Error("Choose an existing proposal scope.");
      }
      const expiresAt = Math.floor(new Date(expiry).getTime() / 1000);
      if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
        throw new Error("Choose a future expiration time.");
      }
      setStatus("sending");
      setMessage("Authorizing agent on BOT Chain...");
      const contract = await wallet.getSignerContract();
      const hash = await setAgentDelegation(contract, normalizedAgent, expiresAt, Math.max(0, proposalId));
      setTxHash(hash);
      setDelegation({ expiresAt, proposalId: Math.max(0, proposalId), active: true, nonce: 0 });
      setMessage("Agent authorization confirmed.");
      setStatus("idle");
    } catch (error) {
      setStatus("error");
      setMessage(friendlyEvmError(error, "Agent authorization failed."));
    }
  };

  const revoke = async () => {
    try {
      const normalizedAgent = validate();
      setStatus("sending");
      setMessage("Revoking agent authorization...");
      const contract = await wallet.getSignerContract();
      const hash = await revokeAgentDelegation(contract, normalizedAgent);
      setTxHash(hash);
      setDelegation((current) => current ? { ...current, active: false } : null);
      setMessage("Agent authorization revoked.");
      setStatus("idle");
    } catch (error) {
      setStatus("error");
      setMessage(friendlyEvmError(error, "Agent revocation failed."));
    }
  };

  return (
    <section className="app-page agents-page">
      <PageHeader
        title="Agent access"
        description="Choose how an agent participates: one signed instruction, scoped delegation, or its own ballot on a public proposal."
      />

      <div className="agent-mode-strip" aria-label="Agent voting modes">
        <div><strong>One-time signature</strong><span>You sign one encrypted ballot for relay. No standing authorization.</span></div>
        <div><strong>Scoped delegation</strong><span>The agent votes for you within an on-chain proposal scope and expiry.</span></div>
        <div><strong>Public agent vote</strong><span>The agent votes as itself on a public proposal. The ballot belongs to its wallet.</span></div>
      </div>

      <div className="agent-workspace">
        <section className="workspace-panel agent-policy-panel">
          <div className="workspace-panel-heading">
            <div><span>Policy editor</span><h2>Delegation policy</h2></div>
            <ShieldCheck size={22} />
          </div>

          <label className="input-label">
            Agent wallet address
            <input className="input" value={agent} onChange={(event) => setAgent(event.target.value)} placeholder="0x..." />
          </label>
          <div className="agent-field-grid">
            <label className="input-label">Authorization expires<input className="input" type="datetime-local" value={expiry} onChange={(event) => setExpiry(event.target.value)} /></label>
            <label className="input-label">Proposal scope<select className="input" value={proposalId} onChange={(event) => setProposalId(Number(event.target.value))}><option value={0}>All proposals</option>{proposalOptions.map((proposal) => <option key={proposal.id} value={proposal.id}>#{proposal.id} {proposal.title}</option>)}</select><small>Choose one proposal or authorize broader access.</small></label>
          </div>

          <div className="agent-actions">
            <button className="cta icon-command" type="button" disabled={status === "sending"} onClick={authorize}><ShieldCheck size={16} /> Authorize agent</button>
            <button className="button-ghost icon-command" type="button" disabled={status === "sending"} onClick={loadDelegation}><Search size={16} /> Inspect status</button>
            <button className="danger-button icon-command" type="button" disabled={status === "sending" || !delegation?.active} onClick={revoke}><ShieldOff size={16} /> Revoke</button>
          </div>

          {message && <div className={`inline-feedback ${status === "error" ? "error" : ""}`}>{message}</div>}
          {txHash && <a className="workspace-explorer-link" href={explorerTx(txHash)} target="_blank" rel="noreferrer">View transaction <ExternalLink size={13} /></a>}
        </section>

        <aside className="workspace-panel authorization-inspector">
          <div className="workspace-panel-heading"><div><span>On-chain state</span><h2>Current authorization</h2></div><span className={`authorization-state ${delegation?.active ? "active" : ""}`}>{delegation?.active ? "Active" : "Unverified"}</span></div>
          {delegation ? (
            <dl className="authorization-facts">
              <div><dt>Status</dt><dd>{delegation.active ? "Active" : "Revoked"}</dd></div>
              <div><dt>Expires</dt><dd>{formatDateTime(delegation.expiresAt)}</dd></div>
              <div><dt>Scope</dt><dd>{delegation.proposalId === 0 ? "All proposals" : `Proposal #${delegation.proposalId}`}</dd></div>
              <div><dt>Next nonce</dt><dd>{delegation.nonce}</dd></div>
            </dl>
          ) : (
            <div className="inspector-empty"><Search size={22} /><p>Enter an agent address and inspect its current contract state.</p></div>
          )}
          <div className="security-boundary"><strong>Signed instruction boundary</strong><p>The relayer cannot alter the voter, proposal, ciphertext, proof hash, nonce, or deadline.</p></div>
        </aside>
      </div>

      <section className="agent-receipt-log">
        <div className="workspace-panel-heading">
          <div><span>Private browser state</span><h2>One-time instruction receipts</h2></div>
          <FileCheck2 size={22} />
        </div>
        {receipts.length ? (
          <div className="agent-receipt-table">
            <div className="agent-receipt-head"><span>Proposal</span><span>Mode</span><span>Private choice</span><span>Expires</span></div>
            {receipts.map((receipt) => (
              <div key={receipt.id}>
                <span><strong>#{receipt.proposalId}</strong> {receipt.proposalTitle}</span>
                <span>One-time signature</span>
                <span>{receipt.option}</span>
                <span>{formatDateTime(receipt.deadline)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="agent-receipt-empty">One-time vote receipts created in this browser will appear here.</p>
        )}
        <p className="agent-receipt-note">Private choices in this list stay in local browser storage and are not returned by the relay API.</p>
      </section>
    </section>
  );
}
