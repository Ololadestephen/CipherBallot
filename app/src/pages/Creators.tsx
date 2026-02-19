import { useMemo, useState, useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import * as anchor from "@coral-xyz/anchor";
import { useNavigate } from "react-router-dom";
import { AdminProposalCard } from "../components/AdminProposalCard";
import { fetchProposals, type ProposalView } from "../lib/proposals";

type View = "dashboard" | "wizard";
type Step = 1 | 2 | 3;
type CreatorStatus = "idle" | "sending" | "success" | "error";

const DEFAULT_OPTIONS = ["Strongly Agree", "Agree", "Neutral", "Disagree", "Strongly Disagree"];

function toLocalDatetimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export default function Creators() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const navigate = useNavigate();

  // View State
  const [view, setView] = useState<View>("dashboard");
  const [myProposals, setMyProposals] = useState<ProposalView[]>([]);
  const [loadingProposals, setLoadingProposals] = useState(false);

  // Wizard State
  const [step, setStep] = useState<Step>(1);
  const [status, setStatus] = useState<CreatorStatus>("idle");
  const [message, setMessage] = useState("");

  // Form Data
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [options, setOptions] = useState<string[]>(DEFAULT_OPTIONS);
  const [proposalId, setProposalId] = useState(() => Math.floor(Date.now() / 1000));

  const [startsImmediately, setStartsImmediately] = useState(true);
  const [scheduledStart, setScheduledStart] = useState(toLocalDatetimeInputValue(new Date()));
  const [durationPreset, setDurationPreset] = useState<"1" | "3" | "7" | "custom">("7");
  const [customDays, setCustomDays] = useState("7");
  const [eligibility, setEligibility] = useState<"anyone" | "token" | "whitelist">("anyone");
  const [requiredMint, setRequiredMint] = useState("");
  const [whitelistRaw, setWhitelistRaw] = useState("");

  const [createdAddress, setCreatedAddress] = useState("");

  const provider = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) return null;
    return new anchor.AnchorProvider(connection, wallet as anchor.Wallet, { commitment: "confirmed" });
  }, [connection, wallet]);

  // Fetch My Proposals
  const loadProposals = async () => {
    if (!wallet.connected || !wallet.publicKey) return;
    setLoadingProposals(true);
    try {
      const all = await fetchProposals(connection);
      const mine = all.filter(p => p.creator === wallet.publicKey?.toBase58());
      setMyProposals(mine);
    } catch (err) {
      console.error("Failed to fetch proposals", err);
    } finally {
      setLoadingProposals(false);
    }
  };

  useEffect(() => {
    if (view === "dashboard" && wallet.connected) {
      loadProposals();
    }
  }, [view, wallet.connected, wallet.publicKey, connection]);

  // Derived Values
  const activeOptions = options.map((opt) => opt.trim()).filter(Boolean);
  const durationDays = durationPreset === "custom" ? Number(customDays) : Number(durationPreset);
  const startDate = startsImmediately ? new Date() : new Date(scheduledStart);
  const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

  // Validation
  const validateStep1 = () => {
    if (!title.trim()) {
      setMessage("Title is required");
      return false;
    }
    setMessage("");
    return true;
  };

  const validateStep2 = () => {
    if (activeOptions.length < 2) {
      setMessage("At least 2 options required");
      return false;
    }
    if (activeOptions.length > 8) {
      setMessage("Max 8 options allowed");
      return false;
    }
    setMessage("");
    return true;
  };

  const handleSubmit = async () => {
    if (!provider) return setMessage("Connect wallet first");

    try {
      setStatus("sending");
      setMessage("Creating proposal & initializing tally...");

      const startTs = Math.floor(startDate.getTime() / 1000);
      const endTs = Math.floor(endDate.getTime() / 1000);
      const whitelistEntries = whitelistRaw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const eligibilityMode = eligibility === "anyone" ? 0 : eligibility === "whitelist" ? 1 : 2;

      const { createProposal, initEncryptedTally } = await import("../lib/arcium");

      // 1. Create Proposal
      const salt = new anchor.BN(proposalId).toArrayLike(Buffer, "le", 8);
      const { proposal } = await createProposal({
        provider,
        proposalSalt: Array.from(salt),
        title: title.trim(),
        options: activeOptions,
        startTs,
        endTs,
        eligibilityMode,
        whitelist: whitelistEntries
      });

      setCreatedAddress(proposal.toBase58());
      setMessage("Proposal created! Initializing tally...");

      // 2. Init Tally
      await initEncryptedTally({
        provider,
        proposalPubkey: proposal,
        optionsCount: activeOptions.length
      });

      setStatus("success");
      setMessage("Success! Proposal is live.");
      loadProposals(); // Refresh list on creation
    } catch (err: any) {
      console.error(err);
      setStatus("error");

      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("0x1") || errMsg.includes("insufficient lamports")) {
        setMessage("Insufficient SOL balance to create proposal (Rent).");
      } else {
        setMessage(errMsg || "Creation failed");
      }
    }
  };

  const resetForm = () => {
    setStep(1);
    setStatus("idle");
    setTitle("");
    setDescription("");
    setOptions(DEFAULT_OPTIONS);
    setProposalId(Math.floor(Date.now() / 1000));
    setCreatedAddress("");
    setView("dashboard");
  };

  // --- RENDER ---

  const renderDashboard = () => (
    <div className="dashboard-view">
      <div className="voters-header">
        <div>
          <h3 className="section-title">Creator Studio</h3>
          <p className="hero-copy" style={{ fontSize: '16px', margin: 0, opacity: 0.7 }}>Manage your confidential proposals</p>
        </div>
        <button className="cta" onClick={() => setView("wizard")}>
          + Create New Proposal
        </button>
      </div>

      {!wallet.connected ? (
        <div className="empty-state">
          <p>Connect your wallet to view your proposals.</p>
        </div>
      ) : loadingProposals ? (
        <div className="loading-state">Loading your proposals...</div>
      ) : myProposals.length === 0 ? (
        <div className="empty-state">
          <strong>No Proposals Yet</strong>
          <p>Create your first confidential proposal to get started.</p>
          <button className="cta secondary" onClick={() => setView("wizard")} style={{ marginTop: '16px' }}>
            Create Proposal
          </button>
        </div>
      ) : (
        <div className="proposal-grid">
          {myProposals.map(p => (
            <AdminProposalCard
              key={p.address}
              proposal={p}
              provider={provider}
              onUpdate={loadProposals}
            />
          ))}
        </div>
      )}
    </div>
  );

  const renderWizard = () => (
    <div className="wizard-view">
      <div className="voters-header">
        <h3 className="section-title">New Proposal</h3>
        <button className="button-ghost small" onClick={resetForm}>Cancel</button>
      </div>

      {status === "success" ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
          <div className="status-badge success" style={{ marginBottom: '20px' }}>
            <span className="value" style={{ fontSize: '40px' }}>✓</span>
          </div>
          <h3>Proposal Created Successfully!</h3>
          <p className="kpi" style={{ marginBottom: '24px' }}>Address: {createdAddress}</p>
          <div className="actions" style={{ justifyContent: 'center' }}>
            <button className="cta" onClick={() => navigate(`/results?proposal=${createdAddress}`)}>View Results Page</button>
            <button className="button-ghost" onClick={resetForm}>Back to Dashboard</button>
          </div>
        </div>
      ) : (
        <div className="proposal-card wizard-card">
          <div className="wizard-progress">
            <div className={`step-dot ${step >= 1 ? 'active' : ''}`}>1</div>
            <div className="step-line"></div>
            <div className={`step-dot ${step >= 2 ? 'active' : ''}`}>2</div>
            <div className="step-line"></div>
            <div className={`step-dot ${step >= 3 ? 'active' : ''}`}>3</div>
          </div>

          {step === 1 && (
            <div className="wizard-step-content">
              <h4>Step 1: Basics</h4>
              <label className="input-label">
                Title
                <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Q2 Roadmap Vote" />
              </label>
              <label className="input-label">
                Description (Optional)
                <textarea className="input textarea" value={description} onChange={e => setDescription(e.target.value)} placeholder="Add context..." rows={4} />
              </label>

              <div className="actions wizard-actions">
                <button className="cta full-width" onClick={() => { if (validateStep1()) setStep(2); }}>Next: Options</button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="wizard-step-content">
              <h4>Step 2: Voting Options</h4>
              <p className="description-text">Define the choices voters can select from.</p>
              <div className="option-list">
                {options.map((opt, i) => (
                  <div key={i} className="option-row" style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <span className="option-label" style={{ alignSelf: 'center', width: '24px', opacity: 0.5 }}>#{i + 1}</span>
                    <input className="input option-input" value={opt} onChange={e => {
                      const newOpts = [...options];
                      newOpts[i] = e.target.value;
                      setOptions(newOpts);
                    }} placeholder={`Option ${i + 1}`} style={{ flex: 1 }} />
                    {options.length > 2 && (
                      <button className="button-ghost icon-only" onClick={() => setOptions(options.filter((_, idx) => idx !== i))} style={{ color: 'var(--error)' }}>
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button className="button-ghost full-width" onClick={() => setOptions([...options, ""])} disabled={options.length >= 8} style={{ marginTop: '12px' }}>
                + Add Option
              </button>

              <div className="actions wizard-actions" style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
                <button className="button-ghost" onClick={() => setStep(1)}>Back</button>
                <button className="cta" style={{ flex: 1 }} onClick={() => { if (validateStep2()) setStep(3); }}>Next: Configuration</button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="wizard-step-content">
              <h4>Step 3: Configuration</h4>

              <div className="form-group">
                <label className="input-label">Start Time</label>
                <div className="inline-options">
                  <label className="radio-row">
                    <input type="radio" checked={startsImmediately} onChange={() => setStartsImmediately(true)} />
                    Start Immediately
                  </label>
                  <label className="radio-row">
                    <input type="radio" checked={!startsImmediately} onChange={() => setStartsImmediately(false)} />
                    Schedule
                  </label>
                </div>
                {!startsImmediately && (
                  <input type="datetime-local" className="input" value={scheduledStart} onChange={e => setScheduledStart(e.target.value)} style={{ marginTop: '8px' }} />
                )}
              </div>

              <div className="form-group">
                <label className="input-label">Duration</label>
                <div className="inline-options">
                  {["1", "3", "7"].map(d => (
                    <label key={d} className="radio-row">
                      <input type="radio" checked={durationPreset === d} onChange={() => setDurationPreset(d as any)} /> {d} Days
                    </label>
                  ))}
                  <label className="radio-row">
                    <input type="radio" checked={durationPreset === "custom"} onChange={() => setDurationPreset("custom")} /> Custom
                  </label>
                </div>
                {durationPreset === "custom" && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                    <input type="number" className="input" value={customDays} onChange={e => setCustomDays(e.target.value)} style={{ width: '80px' }} />
                    <span>Days</span>
                  </div>
                )}
              </div>

              <hr className="divider" />

              <div className="form-group">
                <label className="input-label">Voter Eligibility</label>
                <div className="inline-options">
                  <label className="radio-row"><input type="radio" checked={eligibility === "anyone"} onChange={() => setEligibility("anyone")} /> Public</label>
                  <label className="radio-row"><input type="radio" checked={eligibility === "token"} onChange={() => setEligibility("token")} /> Token Gated</label>
                  <label className="radio-row"><input type="radio" checked={eligibility === "whitelist"} onChange={() => setEligibility("whitelist")} /> Whitelist</label>
                </div>

                {eligibility === "token" && (
                  <input className="input" value={requiredMint} onChange={e => setRequiredMint(e.target.value)} placeholder="Token Mint Address" style={{ marginTop: '8px' }} />
                )}
                {eligibility === "whitelist" && (
                  <div style={{ marginTop: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span className="input-label" style={{ marginBottom: 0 }}>Addresses (One per line)</span>
                      <label className="link" style={{ fontSize: '12px', cursor: 'pointer' }}>
                        Import CSV
                        <input
                          type="file"
                          accept=".csv,.txt"
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = (evt) => {
                              const text = evt.target?.result as string;
                              // Extract potential base58 addresses (32-44 chars)
                              const addresses = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
                              if (addresses) {
                                const unique = Array.from(new Set(addresses));
                                setWhitelistRaw(prev => (prev ? prev + '\n' : '') + unique.join('\n'));
                                setMessage(`Imported ${unique.length} addresses.`);
                              } else {
                                setMessage("No valid addresses found in file.");
                              }
                            };
                            reader.readAsText(file);
                            e.target.value = ''; // Reset
                          }}
                        />
                      </label>
                    </div>
                    <textarea className="input textarea" value={whitelistRaw} onChange={e => setWhitelistRaw(e.target.value)} placeholder="Address 1&#10;Address 2&#10;..." rows={5} />
                  </div>
                )}
              </div>

              <div className="notice-box">
                <strong>Summary</strong>
                <ul style={{ margin: '8px 0 0 16px', padding: 0 }}>
                  <li>{title}</li>
                  <li>{activeOptions.length} Options</li>
                  <li>Duration: {durationDays} Days</li>
                </ul>
              </div>

              {message && <div className={`feedback-msg ${status === 'error' ? 'error' : ''}`}>{message}</div>}

              <div className="actions wizard-actions" style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
                <button className="button-ghost" onClick={() => setStep(2)}>Back</button>
                <button className="cta" style={{ flex: 1 }} onClick={handleSubmit} disabled={status === "sending"}>
                  {status === "sending" ? "Creating..." : "Confirm & Create"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <section className="page-section">
      {view === "dashboard" ? renderDashboard() : renderWizard()}
    </section>
  );
}
