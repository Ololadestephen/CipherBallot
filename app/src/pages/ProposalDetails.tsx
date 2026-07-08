import { useParams, Link } from "react-router-dom";
import { useEffect, useState } from "react";
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

  useEffect(() => {
    void loadProposal();
  }, [id]);

  if (loading) return <div className="loading-state">Loading proposal...</div>;
  if (!proposal) {
    return (
      <div className="empty-state">
        <h3>Proposal Not Found</h3>
        <Link to="/voters" className="button-ghost">Back to Proposals</Link>
      </div>
    );
  }

  return (
    <div className="page-section" style={{ maxWidth: "680px", margin: "0 auto" }}>
      <div style={{ marginBottom: "24px" }}>
        <Link to="/voters" className="link">← Back to Proposals</Link>
      </div>
      <ProposalCard proposal={proposal} onUpdate={loadProposal} />
    </div>
  );
}
