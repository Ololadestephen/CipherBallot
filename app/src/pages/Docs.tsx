import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { CONTRACT_ADDRESS, explorerAddress } from "../lib/evm";

const navigation = [
  { group: "Getting started", items: [{ id: "overview", label: "Overview" }, { id: "quick-start", label: "Quick start" }] },
  { group: "Core concepts", items: [{ id: "architecture", label: "Architecture" }, { id: "human-voting", label: "Human voting" }, { id: "agent-delegation", label: "Agent voting" }, { id: "encryption", label: "Ballot encryption" }, { id: "tallying", label: "Committee tallying" }] },
  { group: "Reference", items: [{ id: "agent-api", label: "Agent API" }, { id: "contract", label: "Contract reference" }, { id: "deployment", label: "Deployment" }, { id: "security", label: "Security model" }] }
];

const allSections = navigation.flatMap((group) => group.items);

function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="docs-code-block">
      <div><span>{language}</span><button onClick={() => void copy()} aria-label="Copy code">{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy"}</button></div>
      <pre><code>{children}</code></pre>
    </div>
  );
}

export default function Docs() {
  const [activeSection, setActiveSection] = useState("overview");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActiveSection(visible[0].target.id);
      },
      { rootMargin: "-100px 0px -65% 0px", threshold: 0 }
    );
    allSections.forEach(({ id }) => {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <section className="docs-page">
      <PageHeader
        title="CipherBallot documentation"
        description="Integrate private human and agent voting, understand the contract lifecycle, and operate committee tallying on BOT Chain."
        actions={CONTRACT_ADDRESS ? <a className="button-ghost icon-command" href={explorerAddress(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer">Verified contract <ExternalLink size={14} /></a> : undefined}
      />

      <div className="docs-layout">
        <aside className="docs-sidebar">
          {navigation.map((group) => (
            <div key={group.group}>
              <strong>{group.group}</strong>
              {group.items.map((item) => <a key={item.id} className={activeSection === item.id ? "active" : ""} href={`#${item.id}`}>{item.label}</a>)}
            </div>
          ))}
        </aside>

        <article className="docs-article">
          <section id="overview">
            <p className="docs-kicker">Overview</p>
            <h2>Private decisions with public settlement</h2>
            <p>CipherBallot is an EVM governance protocol deployed on BOT Chain. It records participation and final outcomes on-chain while preventing readable option totals from appearing during the voting window.</p>
            <p>Humans submit from the web interface. Agents can relay a voter’s one-time signed ballot, act under scoped delegation, or cast their own ballot on an open public proposal.</p>
            <div className="docs-callout"><strong>Deployed V2 contract</strong><code>{CONTRACT_ADDRESS || "Not configured"}</code></div>
          </section>

          <section id="quick-start">
            <p className="docs-kicker">Quick start</p>
            <h2>Run the application locally</h2>
            <p>Install the frontend dependencies, configure the deployed contract, and start Vite.</p>
            <CodeBlock language="bash">{`cd app
npm install
cp .env.example .env
npm run dev`}</CodeBlock>
            <p>The browser application reads only variables prefixed with <code>VITE_</code>. Relayer credentials must remain server-side.</p>
            <CodeBlock language="dotenv">{`VITE_BOTCHAIN_RPC_URL=https://rpc.bohr.life
VITE_BOTCHAIN_EXPLORER_URL=https://scan.bohr.life
VITE_CIPHERBALLOT_CONTRACT_ADDRESS=${CONTRACT_ADDRESS || "0x..."}`}</CodeBlock>
          </section>

          <section id="architecture">
            <p className="docs-kicker">Core concepts</p>
            <h2>Architecture</h2>
            <p>The protocol separates ballot privacy, transaction submission, and finalization authority. Each layer has a narrower responsibility.</p>
            <div className="docs-data-table">
              <div><strong>React application</strong><span>Proposal creation, wallet voting, delegation, results, and proof views.</span></div>
              <div><strong>V2 contract</strong><span>Eligibility, duplicate-vote prevention, delegation, nonces, tally approvals, and finalization.</span></div>
              <div><strong>Agent API</strong><span>Proposal discovery, envelope validation, signed intent checks, and gas relay.</span></div>
              <div><strong>Committee tooling</strong><span>Post-deadline envelope recovery, decryption, transcript generation, and tally submission.</span></div>
            </div>
            <CodeBlock language="text">{"Voter or agent → encrypted ballot → BOT Chain\nCommittee tooling → tally transcript → threshold approvals → final result"}</CodeBlock>
          </section>

          <section id="human-voting">
            <p className="docs-kicker">Human voting</p>
            <h2>One-action secret-sealed ballots</h2>
            <ol>
              <li>The application reads the proposal and its 65-byte secp256k1 election public key.</li>
              <li>The selected option is encrypted in the browser with an ephemeral ECDH shared secret and AES-256-GCM.</li>
              <li>The envelope is bound to chain ID, contract address, proposal ID, and voter address.</li>
              <li>The wallet submits the ciphertext and proof hash. No readable choice enters transaction calldata.</li>
            </ol>
            <p>Commit-reveal remains available as a fallback mode. In that mode, the voter must return after the deadline and reveal the locally stored secret.</p>
          </section>

          <section id="agent-delegation">
            <p className="docs-kicker">Agent voting</p>
            <h2>Three explicit execution modes</h2>
            <div className="docs-data-table">
              <div><strong>One-time voter signature</strong><span>The voter selects and encrypts one choice, signs its final EIP-712 instruction, and gives the packet to an agent for relay. No standing delegation is created.</span></div>
              <div><strong>Scoped delegation</strong><span>The voter authorizes an agent wallet until an expiry for one proposal or all proposals. The ballot is attributed to the voter.</span></div>
              <div><strong>Public agent ballot</strong><span>An agent may vote as itself on an open public proposal. The agent address owns the ballot and consumes its own one-vote allowance.</span></div>
            </div>
            <p>A copied <code>cipherballot-agent-proposal</code> brief contains only the chain, contract, proposal ID, and optional voter address. The agent must fetch canonical proposal data before acting.</p>
            <CodeBlock language="solidity">{`setAgentDelegation(address agent, uint64 expiresAt, uint256 proposalId)
revokeAgentDelegation(address agent)
submitPrivateBallotByVoterSignature(...)
submitPrivateBallotByAgent(...)
submitPublicAgentBallot(...)`}</CodeBlock>
            <p>The voter’s private key is never transferred to the agent or relayer. A public-agent ballot must never be represented as the voter’s ballot.</p>
          </section>

          <section id="encryption">
            <p className="docs-kicker">Ballot encryption</p>
            <h2>Versioned ballot envelopes</h2>
            <p>Each ballot uses a fresh ephemeral secp256k1 key pair. ECDH derives shared material, Keccak-256 derives an AES-256 key, and AES-GCM provides authenticated encryption. The envelope contains the ephemeral public key, IV, ciphertext, and authentication tag.</p>
            <p>The associated data prevents the same envelope from being reused for another proposal, voter, contract, or chain. The API recomputes the envelope proof hash before relaying.</p>
            <div className="docs-warning"><strong>Key handling</strong><p>Creator Studio can generate the election kit transiently in the browser. Only the public key is published; download the recovery kit, store it offline, and never place its private key in the repository, API, or Vercel environment.</p></div>
          </section>

          <section id="tallying">
            <p className="docs-kicker">Committee tallying</p>
            <h2>Post-deadline tally workflow</h2>
            <p>The tally command refuses to decrypt before the voting deadline. After the deadline it recovers ballot calldata, checks proposal context and commitments, decrypts valid envelopes, and produces an option tally.</p>
            <CodeBlock language="bash">{`ELECTION_PRIVATE_KEY=<OFFCHAIN_ELECTION_PRIVATE_KEY> \\
PROPOSAL_ID=1 \\
CIPHERBALLOT_CONTRACT_ADDRESS=${CONTRACT_ADDRESS || "0x..."} \\
DEPLOYMENT_BLOCK=<DEPLOYMENT_BLOCK> \\
npm run tally`}</CodeBlock>
            <p>Committee approvals bind to the proposal ID, final tally, transcript URI, tally proof hash, and tally secret. Mismatched approvals are rejected.</p>
          </section>

          <section id="agent-api">
            <p className="docs-kicker">Agent API</p>
            <h2>Discover, submit, and monitor</h2>
            <div className="docs-endpoints">
              <div><code>GET</code><strong>/api/v1/proposals</strong><span>Discover proposals and election public keys.</span></div>
              <div><code>GET</code><strong>/api/v1/health</strong><span>Verify BOT Chain, Redis, and the serialized relay queue.</span></div>
              <div><code>POST</code><strong>/api/v1/votes</strong><span>Validate and queue a signed encrypted ballot.</span></div>
              <div><code>GET</code><strong>/api/v1/votes?jobId=cb_...</strong><span>Read queued, processing, submitted, confirmed, or failed status.</span></div>
              <div><code>GET</code><strong>/api/v1/votes?txHash=0x...</strong><span>Read pending, confirmed, or reverted status.</span></div>
            </div>
            <h3>Submit a signed ballot</h3>
            <CodeBlock language="json">{`{
  "mode": "delegated",
  "proposalId": "1",
  "voter": "0x...",
  "agent": "0x...",
  "encryptedBallot": "0x...",
  "ballotProofHash": "0x...",
  "nonce": "0",
  "deadline": "1785859200",
  "signature": "0x..."
}`}</CodeBlock>
            <p><code>mode</code> accepts <code>delegated</code>, <code>voter-signed</code>, or <code>public-agent</code>. Each mode uses a separate EIP-712 structure and nonce space, preventing a signature from being replayed through another path.</p>
            <CodeBlock language="bash">{`npm run agent -- inspect '<proposal-brief-json>'
npm run agent -- vote-for-voter '<proposal-brief-json>' --option 0
npm run agent -- vote-as-agent '<proposal-brief-json>' --option 0
npm run agent -- submit-signed '<signed-vote-json>'`}</CodeBlock>
            <p>The endpoint requires an API key, checks the mode-specific signer authority, nonce, deadline, envelope structure, proof hash, request size, and transaction simulation before queueing a deterministic relay job. Redis deduplicates requests and QStash delivers one signed worker request at a time.</p>
          </section>

          <section id="contract">
            <p className="docs-kicker">Contract reference</p>
            <h2>Core V2 methods</h2>
            <div className="docs-data-table contract-methods">
              <div><code>createThresholdProposal</code><span>Create a secret-sealed election with committee policy.</span></div>
              <div><code>submitPrivateBallot</code><span>Submit an encrypted ballot directly from a voter.</span></div>
              <div><code>submitPrivateBallotByAgent</code><span>Verify delegation and an EIP-712 signed agent intent.</span></div>
              <div><code>submitPrivateBallotByVoterSignature</code><span>Relay one final ballot signed directly by the voter.</span></div>
              <div><code>submitPublicAgentBallot</code><span>Attribute an open-proposal ballot to the signing agent.</span></div>
              <div><code>approveThresholdTally</code><span>Approve a shared post-deadline tally transcript.</span></div>
              <div><code>getPrivacyConfig</code><span>Read mode, committee threshold, approvals, and proof references.</span></div>
            </div>
          </section>

          <section id="deployment">
            <p className="docs-kicker">Deployment</p>
            <h2>Server-side environment</h2>
            <p>The agent API requires a funded, dedicated relayer wallet and an API key of at least 32 characters. Never expose either secret through a variable prefixed with <code>VITE_</code>.</p>
            <CodeBlock language="dotenv">{`BOTCHAIN_RPC_URL=https://rpc.bohr.life
BOTCHAIN_CHAIN_ID=968
BOTCHAIN_EXPLORER_URL=https://scan.bohr.life
CIPHERBALLOT_CONTRACT_ADDRESS=${CONTRACT_ADDRESS || "0x..."}
RELAYER_PRIVATE_KEY=<SERVER_SECRET>
RELAYER_EXPECTED_ADDRESS=<RELAYER_WALLET_ADDRESS>
AGENT_API_KEY=<RANDOM_KEY_OF_AT_LEAST_32_CHARACTERS>
AGENT_API_ALLOWED_ORIGIN=https://www.cipherballot.xyz
AGENT_API_ALLOWED_SIGNERS=<OPTIONAL_COMMA_SEPARATED_SIGNERS>
AGENT_API_RATE_LIMIT_PER_MINUTE=30
AGENT_SIGNER_RATE_LIMIT_PER_MINUTE=10
AGENT_VOTE_MAX_DEADLINE_SECONDS=3600
AGENT_RELAY_MAX_GAS=500000
KV_REST_API_URL=<SERVER_ONLY_REDIS_REST_URL>
KV_REST_API_TOKEN=<SERVER_ONLY_REDIS_WRITE_TOKEN>
QSTASH_TOKEN=<SERVER_ONLY_QSTASH_TOKEN>
QSTASH_CURRENT_SIGNING_KEY=<SERVER_ONLY_SIGNING_KEY>
QSTASH_NEXT_SIGNING_KEY=<SERVER_ONLY_SIGNING_KEY>
QSTASH_QUEUE_NAME=cipherballot-relayer-v1
AGENT_RELAY_WORKER_URL=https://www.cipherballot.xyz/api/internal/relay-worker
AGENT_RELAY_PUBLIC_URL=https://www.cipherballot.xyz`}</CodeBlock>
          </section>

          <section id="security">
            <p className="docs-kicker">Security model</p>
            <h2>Trust boundaries</h2>
            <div className="docs-data-table">
              <div><strong>Voter wallet</strong><span>Controls direct voting, signs a single final ballot, or grants and revokes scoped agent authority.</span></div>
              <div><strong>Agent wallet</strong><span>Signs delegated intents or its own public ballots; it cannot transfer voter funds.</span></div>
              <div><strong>Relayer</strong><span>Pays gas but cannot alter signed fields or bypass contract checks.</span></div>
              <div><strong>Committee</strong><span>Currently custodies the election private key and approves one shared tally.</span></div>
            </div>
            <div className="docs-warning"><strong>Production relayer coordination</strong><p>Redis persists idempotent jobs, locks, and rate limits across instances. A signature-verified QStash FIFO worker serializes relayer transactions and reconciles retries.</p></div>
            <div className="docs-warning"><strong>Current cryptographic boundary</strong><p>V2 uses a committee-custodied election private key plus on-chain threshold tally approval. It does not yet implement distributed key generation or true threshold decryption.</p></div>
            <div className="docs-warning"><strong>Tally correctness boundary</strong><p>The contract caps the final tally by recorded participation and requires matching committee evidence, but it does not yet verify a zero-knowledge proof that every counted choice was decrypted correctly.</p></div>
            <div className="docs-warning"><strong>Autonomy boundary</strong><p>The current release is agent-executable through briefs, a client, CLI, and durable relay jobs. Persistent proposal monitoring, policy evaluation, and unattended decision-making remain roadmap work.</p></div>
          </section>
        </article>

        <aside className="docs-toc">
          <strong>On this page</strong>
          {allSections.map((item) => <a key={item.id} className={activeSection === item.id ? "active" : ""} href={`#${item.id}`}>{item.label}</a>)}
        </aside>
      </div>
    </section>
  );
}
