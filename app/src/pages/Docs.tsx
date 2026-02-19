const docSections = [
  {
    title: "How Arcium keeps votes private",
    body:
      "Votes are encrypted client-side and only processed inside Arcium's encrypted shared state. Intermediate tallies never appear in plaintext on-chain."
  },
  {
    title: "What gets published to Solana",
    body:
      "Only final tallies and verification proofs are stored on Solana, ensuring transparency without leaking voting signals."
  },
  {
    title: "Lifecycle",
    body:
      "Create proposal → init encrypted tally → cast encrypted votes → finalize reveal + proof."
  }
];

export default function Docs() {
  return (
    <section>
      <h3 className="section-title">Docs</h3>
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
