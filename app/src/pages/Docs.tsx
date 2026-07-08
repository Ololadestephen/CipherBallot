const docSections = [
  {
    title: "Privacy Model",
    body:
      "CipherBallot supports secret-sealed threshold proposals for one-action voting. Voters submit a private ballot capsule during the active window, and live option choices are not published on-chain."
  },
  {
    title: "Threshold Committee",
    body:
      "A proposal can name a committee and require a threshold of members to approve the same tally hash after the deadline. This avoids giving any single coordinator unilateral finalization power."
  },
  {
    title: "Tally Transcript",
    body:
      "Committee approvals bind to the proposal id, final tally, transcript URI, tally proof hash, and shared tally secret. Mismatched approvals are rejected, so finalization only happens around one shared transcript."
  },
  {
    title: "Eligibility",
    body:
      "Creators can run public proposals or upload an allowlist of eligible EVM addresses. Allowlisted proposals reject ballot submissions from wallets outside the list."
  },
  {
    title: "BOT Chain Evidence",
    body:
      "The proof page reads the latest block, contract address, proposal count, private ballot counts, threshold approvals, and status counts from BOT Chain RPC and links back to the explorer."
  },
  {
    title: "Fallback Mode",
    body:
      "The contract still keeps commit-reveal as a fallback mode, but the recommended demo path is secret-sealed threshold proposal -> one-action private ballot -> committee tally approval -> final results."
  }
];

export default function Docs() {
  return (
    <section>
      <div className="voters-header">
        <div>
          <h3 className="section-title">Technical Write-Up</h3>
          <p className="hero-copy" style={{ fontSize: "16px", margin: 0, opacity: 0.7 }}>
            How CipherBallot preserves private voting signals while keeping final outcomes verifiable on BOT Chain.
          </p>
        </div>
      </div>
      <div className="grid">
        {docSections.map((section) => (
          <div className="card" key={section.title}>
            <strong>{section.title}</strong>
            <p>{section.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
