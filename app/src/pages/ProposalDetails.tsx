import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { ProposalCard } from "../components/ProposalCard";
import { fetchProposal, type ProposalView } from "../lib/evm";

export default function ProposalDetails() {
  const { id } = useParams();
  const [proposal, setProposal] = useState<ProposalView | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProposal = async () => {
    if (!id) return;
    setLoading(true);
    try {
      setProposal(await fetchProposal(Number(id)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadProposal(); }, [id]);

  if (loading) return <div className="loading-state app-loading-state">Loading proposal...</div>;
  if (!proposal) {
    return (
      <div className="app-empty-state">
        <strong>Proposal not found</strong>
        <p>The requested proposal does not exist on the configured CipherBallot contract.</p>
        <Link to="/voters" className="button-ghost icon-command"><ArrowLeft size={16} /> Back to proposals</Link>
      </div>
    );
  }

  return (
    <section className="app-page proposal-detail-page">
      <Link to="/voters" className="app-back-link"><ArrowLeft size={15} /> Proposal explorer</Link>
      <PageHeader
        title={proposal.title}
        description="Review the decision policy, select an option, and submit your ballot directly to BOT Chain."
        status={<span className={`pill status-${proposal.status.toLowerCase()}`}>{proposal.status}</span>}
      />
      <div className="proposal-detail-workspace">
        <ProposalCard proposal={proposal} onUpdate={loadProposal} defaultExpanded />
      </div>
    </section>
  );
}
