import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import * as anchor from "@coral-xyz/anchor";
import {
  fetchProposals,
  type ProposalView
} from "../lib/proposals";
import { ProposalCard } from "../components/ProposalCard";

export default function Voters() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [allProposals, setAllProposals] = useState<ProposalView[]>([]);
  const [loading, setLoading] = useState(true);
  const [arciumStatus, setArciumStatus] = useState<string>("Initializing...");
  const [filter, setFilter] = useState<"All" | "Active" | "Ended" | "My Whitelisted">("All");

  const filteredProposals = useMemo(() => {
    let result = [...allProposals];

    // Filter
    if (filter === "Active") {
      result = result.filter(p => p.status === "Active");
    } else if (filter === "Ended") {
      result = result.filter(p => p.status === "Ended");
    } else if (filter === "My Whitelisted") {
      if (!wallet.publicKey) return [];
      const myKey = wallet.publicKey.toBase58();

      result = result.filter(p => p.whitelist?.includes(myKey));
    }

    // Sort: Active/Upcoming first, Ended last.
    // Within groups, maybe by startTs descending (newest first).
    result.sort((a, b) => {
      const isEndedA = a.status === "Ended" ? 1 : 0;
      const isEndedB = b.status === "Ended" ? 1 : 0;
      if (isEndedA !== isEndedB) return isEndedA - isEndedB; // Ended goes last (1 > 0)
      return b.startTs - a.startTs; // Newest first
    });

    return result;
  }, [allProposals, filter, wallet.publicKey]);

  const provider = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) {
      return null;
    }
    return new anchor.AnchorProvider(connection, wallet as anchor.Wallet, {
      commitment: "confirmed"
    });
  }, [connection, wallet]);

  // Initial data load
  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const rows = await fetchProposals(connection);
        if (!alive) return;
        setAllProposals(rows);
      } catch (err) {
        console.error("Failed to fetch proposals", err);
      } finally {
        if (alive) setLoading(false);
      }
    };
    run();

    // Poll for updates
    const intervalId = window.setInterval(() => {
      if (!alive) return;
      run();
    }, 5000);

    return () => {
      alive = false;
      window.clearInterval(intervalId);
    };
  }, [connection]);

  // Arcium readiness check (global status)
  useEffect(() => {
    let alive = true;
    const checkArcium = async () => {
      if (!provider) {
        setArciumStatus("Connect wallet to check Arcium status");
        return;
      }
      try {
        const { checkArciumReadiness } = await import("../lib/arcium");
        const status = await checkArciumReadiness(provider);
        if (!alive) return;
        setArciumStatus(status.ready ? "Active" : "Not Ready");
      } catch (err) {
        if (alive) setArciumStatus("Error checking status");
      }
    };
    checkArcium();
  }, [provider]);

  return (
    <section>
      <div className="voters-header">
        <div>
          <h3 className="section-title">Voter Dashboard</h3>
          <p className="hero-copy" style={{ margin: 0, fontSize: "16px", maxWidth: "none" }}>
            Participate in confidential governance. Your votes are encrypted on-chain.
          </p>
        </div>
        <div className="status-badge">
          <span className="label">Arcium Network:</span>
          <span className={`value ${arciumStatus === "Active" ? "success" : "warning"}`}>
            {arciumStatus}
          </span>
        </div>
      </div>

      <div style={{ marginBottom: "24px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
        {["All", "Active", "Ended", "My Whitelisted"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f as any)}
            className={`filter-chip ${filter === f ? "active" : ""}`}
            style={{
              padding: "8px 16px",
              borderRadius: "99px",
              border: `1px solid ${filter === f ? "var(--primary)" : "var(--stroke)"}`,
              background: filter === f ? "rgba(123, 97, 255, 0.15)" : "transparent",
              color: filter === f ? "#fff" : "var(--text-secondary)",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
              transition: "all 0.2s"
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading-state">Loading actual proposals...</div>
      ) : (
        <div className="proposal-grid">
          {filteredProposals.map((p) => (
            <ProposalCard key={p.address} proposal={p} provider={provider} />
          ))}
          {filteredProposals.length === 0 && (
            <div className="empty-state">
              <strong>No Proposals Found</strong>
              <p>Try adjusting your filters.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
