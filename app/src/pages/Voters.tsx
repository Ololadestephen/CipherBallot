import { ChevronLeft, ChevronRight, Plus, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { ProposalCard } from "../components/ProposalCard";
import { RevealReminderPanel } from "../components/RevealReminderPanel";
import { BOT_CHAIN, fetchProposals, type ProposalView, useEvmWallet } from "../lib/evm";
import { normalizeProposalCode, proposalCode } from "../lib/proposalCode";

const filters = ["All", "Active", "Reveal", "Tallying", "Finalized"] as const;
type ProposalFilter = typeof filters[number];

export default function Voters() {
  const wallet = useEvmWallet();
  const navigate = useNavigate();
  const [allProposals, setAllProposals] = useState<ProposalView[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<ProposalFilter>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 6;

  const loadProposals = async (showLoading = allProposals.length === 0) => {
    if (showLoading) setLoading(true);
    else setRefreshing(true);
    try {
      setAllProposals(await fetchProposals());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadProposals(true);
    const intervalId = window.setInterval(() => void loadProposals(false), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const filteredProposals = useMemo(() => {
    let result = allProposals;
    if (filter !== "All") result = result.filter((proposal) => proposal.status === filter);
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      result = result.filter((proposal) => proposal.title.toLowerCase().includes(query)
        || String(proposal.id) === query
        || normalizeProposalCode(proposalCode(proposal.id)) === normalizeProposalCode(query));
    }
    return result;
  }, [allProposals, filter, searchQuery]);

  useEffect(() => setCurrentPage(1), [filter, searchQuery]);

  const paginatedProposals = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredProposals.slice(startIndex, startIndex + pageSize);
  }, [filteredProposals, currentPage]);

  const totalPages = Math.ceil(filteredProposals.length / pageSize);
  const networkReady = wallet.connected && wallet.chainId === BOT_CHAIN.chainId;

  return (
    <section className="app-page voters-page">
      <PageHeader
        title="Proposal explorer"
        description="Find an open decision, review its privacy policy, and submit an encrypted ballot on BOT Chain."
        status={
          <div className={`network-indicator ${networkReady ? "ready" : "attention"}`}>
            <span />
            {networkReady ? "BOT Chain connected" : wallet.connected ? "Network switch required" : "Wallet not connected"}
          </div>
        }
        actions={
          <button className="button-ghost icon-command" onClick={() => navigate("/creators")}>
            <Plus size={16} /> Create proposal
          </button>
        }
      />

      <div className="proposal-toolbar">
        <div className="segmented-filter" aria-label="Filter proposals">
          {filters.map((item) => (
            <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>
          ))}
        </div>
        <div className="proposal-toolbar-actions">
          <label className="search-control">
            <Search size={16} />
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search title or ID" />
          </label>
          <button className="icon-button" title="Refresh proposals" aria-label="Refresh proposals" onClick={() => void loadProposals(false)} disabled={refreshing}>
            <RefreshCw size={16} className={refreshing ? "spin" : ""} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="loading-state app-loading-state">Reading proposals from BOT Chain...</div>
      ) : (
        <>
          <RevealReminderPanel proposals={allProposals} />
          <div className="proposal-results-meta">
            <span>{filteredProposals.length} proposal{filteredProposals.length === 1 ? "" : "s"}</span>
            <span>Updated from contract state</span>
          </div>

          {filteredProposals.length ? (
            <div className="proposal-grid">
              {paginatedProposals.map((proposal) => (
                <ProposalCard key={proposal.id} proposal={proposal} onUpdate={() => void loadProposals(false)} />
              ))}
            </div>
          ) : (
            <div className="app-empty-state">
              <strong>No matching proposals</strong>
              <p>Change the status filter, clear your search, or start a new governance decision.</p>
              <button className="cta icon-command" onClick={() => navigate("/creators")}><Plus size={16} /> Create proposal</button>
            </div>
          )}

          {totalPages > 1 && (
            <nav className="app-pagination" aria-label="Proposal pages">
              <button className="icon-button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>
                <ChevronLeft size={17} />
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button className="icon-button" aria-label="Next page" disabled={currentPage === totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}>
                <ChevronRight size={17} />
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
