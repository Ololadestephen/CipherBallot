import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BOT_CHAIN, fetchProposals, type ProposalView, useEvmWallet } from "../lib/evm";
import { ProposalCard } from "../components/ProposalCard";
import { RevealReminderPanel } from "../components/RevealReminderPanel";

export default function Voters() {
  const wallet = useEvmWallet();
  const navigate = useNavigate();
  const [allProposals, setAllProposals] = useState<ProposalView[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"All" | "Active" | "Reveal" | "Tallying" | "Finalized">("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 6;

  const loadProposals = async (showLoading = allProposals.length === 0) => {
    if (showLoading) setLoading(true);
    try {
      setAllProposals(await fetchProposals());
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    void loadProposals(true);
    const intervalId = window.setInterval(() => void loadProposals(false), 60000);
    return () => window.clearInterval(intervalId);
  }, []);

  const filteredProposals = useMemo(() => {
    let result = allProposals;
    if (filter !== "All") {
      result = result.filter((proposal) => proposal.status === filter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p => p.title.toLowerCase().includes(q) || String(p.id) === q);
    }
    return result;
  }, [allProposals, filter, searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filter, searchQuery]);

  const paginatedProposals = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return filteredProposals.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredProposals, currentPage]);
  
  const totalPages = Math.ceil(filteredProposals.length / PAGE_SIZE);

  return (
    <section>
      <div className="voters-header">
        <div>
          <h3 className="section-title">Voter Dashboard</h3>
          <p className="hero-copy" style={{ margin: 0, fontSize: "16px", maxWidth: "none" }}>
            Submit private ballots on BOT Chain without exposing live vote choices.
          </p>
        </div>
        <div className="status-badge">
          <span className="label">Network:</span>
          <span className={`value ${wallet.chainId === BOT_CHAIN.chainId ? "success" : "warning"}`}>
            {wallet.chainId === BOT_CHAIN.chainId ? "BOT Chain" : "Switch Required"}
          </span>
        </div>
      </div>

      <div style={{ marginTop: "24px", marginBottom: "32px", display: "flex", gap: "16px", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          {["All", "Active", "Reveal", "Tallying", "Finalized"].map((item) => (
            <button
              key={item}
              onClick={() => setFilter(item as typeof filter)}
              className={`filter-chip ${filter === item ? "active" : ""}`}
              style={{
                padding: "8px 16px",
                borderRadius: "99px",
                border: `1px solid ${filter === item ? "var(--primary)" : "var(--stroke)"}`,
                background: filter === item ? "rgba(123, 97, 255, 0.15)" : "transparent",
                color: filter === item ? "#fff" : "var(--text-secondary)",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: 600
              }}
            >
              {item}
            </button>
          ))}
        </div>
        <input 
          type="text" 
          placeholder="Search by title or ID..." 
          className="input" 
          style={{ maxWidth: "300px", margin: 0 }} 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="loading-state">Loading BOT Chain proposals...</div>
      ) : (
        <>
          <RevealReminderPanel proposals={allProposals} />
          <div className="proposal-grid">
            {paginatedProposals.map((proposal) => (
              <ProposalCard key={proposal.id} proposal={proposal} onUpdate={() => void loadProposals(false)} />
            ))}
            {filteredProposals.length === 0 && (
              <div className="empty-state">
                <strong>No Proposals Found</strong>
                <p>Try another status filter or create a new proposal.</p>
                <button className="cta" style={{ marginTop: "16px" }} onClick={() => navigate("/creators")}>
                  Create a Proposal
                </button>
              </div>
            )}
          </div>
          {totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "center", gap: "12px", marginTop: "32px" }}>
              <button 
                className="button-ghost" 
                disabled={currentPage === 1} 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span style={{ display: "flex", alignItems: "center", fontSize: "14px", color: "var(--text-secondary)" }}>
                Page {currentPage} of {totalPages}
              </span>
              <button 
                className="button-ghost" 
                disabled={currentPage === totalPages} 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
