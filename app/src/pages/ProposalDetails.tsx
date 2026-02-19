import { useParams, Link } from "react-router-dom";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import * as anchor from "@coral-xyz/anchor";
import { useEffect, useMemo, useState } from "react";
import { ProposalCard } from "../components/ProposalCard";
import { fetchProposals, type ProposalView } from "../lib/proposals";

export default function ProposalDetails() {
  const { id } = useParams();
  const { connection } = useConnection();
  const wallet = useWallet();
  const [proposal, setProposal] = useState<ProposalView | null>(null);
  const [loading, setLoading] = useState(true);

  const provider = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) return null;
    return new anchor.AnchorProvider(connection, wallet as anchor.Wallet, { commitment: "confirmed" });
  }, [connection, wallet]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchProposals(connection).then(all => {
      const found = all.find(p => p.address === id);
      setProposal(found || null);
    }).finally(() => setLoading(false));
  }, [id, connection]);

  if (loading) return <div className="loading-state">Loading proposal...</div>;
  if (!proposal) return (
    <div className="empty-state">
      <h3>Proposal Not Found</h3>
      <Link to="/voters" className="button-ghost">Back to Proposals</Link>
    </div>
  );

  return (
    <div className="page-section" style={{ maxWidth: '680px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <Link to="/voters" className="link">← Back to Proposals</Link>
      </div>
      <ProposalCard proposal={proposal} provider={provider} />
    </div>
  );
}
