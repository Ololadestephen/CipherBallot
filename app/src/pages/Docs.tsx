import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { BOT_CHAIN, CONTRACT_ADDRESS, explorerAddress } from "../lib/evm";

const navigation = [
  {
    group: "Getting started",
    items: [
      { id: "overview", label: "Overview" },
      { id: "network", label: "Network and status" },
      { id: "quick-start", label: "Quick start" }
    ]
  },
  {
    group: "Core concepts",
    items: [
      { id: "architecture", label: "Architecture" },
      { id: "roles", label: "Roles and permissions" },
      { id: "lifecycle", label: "Proposal lifecycle" },
      { id: "privacy-modes", label: "Privacy modes" },
      { id: "human-voting", label: "Human voting" },
      { id: "agent-voting", label: "Agent voting" },
      { id: "encryption", label: "Ballot encryption" }
    ]
  },
  {
    group: "Operations",
    items: [
      { id: "creating", label: "Create a proposal" },
      { id: "tallying", label: "Committee tallying" },
      { id: "verification", label: "Results and proof" }
    ]
  },
  {
    group: "Reference",
    items: [
      { id: "agent-api", label: "Agent API" },
      { id: "contract", label: "Contract reference" },
      { id: "configuration", label: "Configuration" },
      { id: "deployment", label: "Deployment" },
      { id: "testing", label: "Testing" },
      { id: "troubleshooting", label: "Troubleshooting" },
      { id: "security", label: "Security model" },
      { id: "roadmap", label: "Roadmap" }
    ]
  }
];

const allSections = navigation.flatMap((group) => group.items);
const repositoryUrl = "https://github.com/Ololadestephen/CipherBallot";
const liveUrl = "https://www.cipherballot.xyz";

function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="docs-code-block">
      <div>
        <span>{language}</span>
        <button type="button" onClick={() => void copy()} aria-label="Copy code">
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre><code>{children}</code></pre>
    </div>
  );
}

export default function Docs() {
  const [activeSection, setActiveSection] = useState("overview");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
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
        description="Build, integrate, and operate private human and agent governance on BOT Chain."
        actions={(
          <div className="docs-header-actions">
            <a className="button-ghost icon-command" href={repositoryUrl} target="_blank" rel="noreferrer">GitHub <ExternalLink size={14} /></a>
            {CONTRACT_ADDRESS && <a className="button-ghost icon-command" href={explorerAddress(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer">Verified contract <ExternalLink size={14} /></a>}
          </div>
        )}
      />

      <div className="docs-layout">
        <aside className="docs-sidebar" aria-label="Documentation navigation">
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
            <p>CipherBallot is an EVM governance protocol for communities, committees, DAOs, and autonomous agents. It records eligibility, participation, delegation, approvals, and final outcomes on BOT Chain while keeping readable choices outside the active voting window.</p>
            <p>People can vote from the application, sign a single ballot for relay, or delegate a narrow voting permission. Agents can execute those signed instructions, act under an active delegation, or vote under their own identity on an open proposal.</p>
            <div className="docs-callout">
              <strong>Current release</strong>
              <p>CipherBallot V2 is a pre-audit testnet release. It is suitable for pilots and evaluation, not binding elections or high-value treasury governance.</p>
            </div>
            <div className="docs-data-table">
              <div><strong>Private participation</strong><span>Secret-sealed ballots publish ciphertext and commitments instead of readable choices.</span></div>
              <div><strong>Agent execution</strong><span>Three mode-separated EIP-712 paths support voter-signed, delegated, and public-agent ballots.</span></div>
              <div><strong>Committee finalization</strong><span>Multiple committee accounts must approve exactly the same post-deadline tally evidence.</span></div>
              <div><strong>Public verification</strong><span>Proposal state, participation totals, approvals, evidence references, and final tallies remain inspectable on-chain.</span></div>
            </div>
          </section>

          <section id="network">
            <p className="docs-kicker">Getting started</p>
            <h2>Network and deployment status</h2>
            <div className="docs-data-table">
              <div><strong>Application</strong><span><a className="docs-inline-link" href={liveUrl} target="_blank" rel="noreferrer">www.cipherballot.xyz</a></span></div>
              <div><strong>Network</strong><span>{BOT_CHAIN.name}</span></div>
              <div><strong>Chain ID</strong><span><code>{BOT_CHAIN.chainId}</code> / <code>{BOT_CHAIN.chainHex}</code></span></div>
              <div><strong>Native currency</strong><span>{BOT_CHAIN.nativeCurrency.symbol}, {BOT_CHAIN.nativeCurrency.decimals} decimals</span></div>
              <div><strong>RPC</strong><span><code>{BOT_CHAIN.rpcUrl}</code></span></div>
              <div><strong>Explorer</strong><span><a className="docs-inline-link" href={BOT_CHAIN.explorerUrl} target="_blank" rel="noreferrer">{BOT_CHAIN.explorerUrl}</a></span></div>
              <div><strong>V2 contract</strong><span><code>{CONTRACT_ADDRESS || "Not configured"}</code></span></div>
              <div><strong>Source</strong><span><a className="docs-inline-link" href={repositoryUrl} target="_blank" rel="noreferrer">Ololadestephen/CipherBallot</a></span></div>
            </div>
            <p>The wallet control can add BOT Chain Testnet with <code>wallet_addEthereumChain</code> or switch an existing entry with <code>wallet_switchEthereumChain</code>.</p>
          </section>

          <section id="quick-start">
            <p className="docs-kicker">Quick start</p>
            <h2>Run the application locally</h2>
            <h3>Prerequisites</h3>
            <ul>
              <li>Node.js 20 or newer and npm.</li>
              <li>Foundry for contract builds, tests, deployment, and local Anvil workflows.</li>
              <li>An EVM browser wallet for proposal creation and direct voting.</li>
            </ul>
            <CodeBlock language="bash">{`git clone https://github.com/Ololadestephen/CipherBallot.git
cd CipherBallot/app
npm install
cp .env.example .env
npm run dev`}</CodeBlock>
            <p>Open <code>http://localhost:5173</code>, connect a wallet, and use the network control to add or switch to BOT Chain Testnet.</p>
            <h3>Minimum browser configuration</h3>
            <CodeBlock language="dotenv">{`VITE_BOTCHAIN_RPC_URL=${BOT_CHAIN.rpcUrl}
VITE_BOTCHAIN_EXPLORER_URL=${BOT_CHAIN.explorerUrl}
VITE_CIPHERBALLOT_CONTRACT_ADDRESS=${CONTRACT_ADDRESS || "0x..."}`}</CodeBlock>
            <div className="docs-warning"><strong>Public variables only</strong><p>Every <code>VITE_</code> value is bundled into browser JavaScript. Never use that prefix for a private key, API key, election key, tally secret, or relayer credential.</p></div>
          </section>

          <section id="architecture">
            <p className="docs-kicker">Core concepts</p>
            <h2>Architecture</h2>
            <p>The protocol separates user experience, ballot authority, transaction sponsorship, and finalization. A relayer can pay gas, but it cannot manufacture a valid ballot or change fields protected by a signature.</p>
            <div className="docs-data-table">
              <div><strong>React application</strong><span>Wallet connection, network switching, proposal creation, encryption, voting, delegation, results, proof, and committee operations.</span></div>
              <div><strong>V2 contract</strong><span>Proposal rules, eligibility, one-ballot enforcement, delegation, EIP-712 verification, nonce handling, tally approvals, and finalization.</span></div>
              <div><strong>Agent client and CLI</strong><span>Canonical proposal verification, local encryption, mode-specific signing, relay submission, and status polling.</span></div>
              <div><strong>Agent API</strong><span>Authenticated discovery, strict request validation, contract simulation, durable idempotency, and relay job status.</span></div>
              <div><strong>Redis and QStash</strong><span>Cross-instance rate limits, job persistence, distributed locks, and a signature-verified FIFO relay worker.</span></div>
              <div><strong>Committee tooling</strong><span>Post-deadline envelope recovery, validation, decryption, transcript generation, and threshold approvals.</span></div>
            </div>
            <CodeBlock language="text">{"Human or agent\n  → locally encrypted ballot\n  → wallet transaction or authenticated relay API\n  → CipherBallot contract on BOT Chain\n  → post-deadline committee transcript\n  → matching threshold approvals\n  → finalized on-chain result"}</CodeBlock>
          </section>

          <section id="roles">
            <p className="docs-kicker">Core concepts</p>
            <h2>Roles and permissions</h2>
            <div className="docs-data-table">
              <div><strong>Proposal creator</strong><span>Defines the decision, options, voting window, privacy mode, eligibility policy, committee, and approval threshold.</span></div>
              <div><strong>Voter</strong><span>Owns one ballot per proposal and may vote directly, sign one final ballot, or authorize and revoke an agent.</span></div>
              <div><strong>Agent</strong><span>Signs a delegated ballot or its own public ballot. It receives no custody of the voter wallet.</span></div>
              <div><strong>Relayer</strong><span>Submits a valid signed ballot and pays transaction gas. The contract still enforces signer authority and current state.</span></div>
              <div><strong>Committee member</strong><span>Validates post-deadline evidence and approves one exact tally hash. A single member cannot finalize a threshold proposal.</span></div>
              <div><strong>Operator</strong><span>Protects recovery kits and relayer secrets, monitors infrastructure, publishes evidence, and coordinates the committee.</span></div>
            </div>
            <p>Public proposals provide one-address-one-ballot participation. Use an allowlist when membership or Sybil resistance is required.</p>
          </section>

          <section id="lifecycle">
            <p className="docs-kicker">Core concepts</p>
            <h2>Proposal lifecycle</h2>
            <ol>
              <li><strong>Configure:</strong> define unique options, timing, privacy, eligibility, and committee policy.</li>
              <li><strong>Publish:</strong> the creator signs the creation transaction and the contract emits <code>ProposalCreated</code>.</li>
              <li><strong>Scheduled:</strong> the proposal is visible but rejects ballots until its start timestamp.</li>
              <li><strong>Active:</strong> eligible addresses may submit one ballot until the inclusive end timestamp.</li>
              <li><strong>Post-deadline:</strong> commit-reveal voters reveal, or the secret-sealed committee prepares and checks tally evidence.</li>
              <li><strong>Finalized:</strong> the contract records the final tally after the reveal rule or committee threshold is satisfied.</li>
            </ol>
            <div className="docs-warning"><strong>Immutable election configuration</strong><p>Published options, dates, eligibility, committee membership, threshold, and election public key cannot be edited. Create a new proposal when any of them must change.</p></div>
          </section>

          <section id="privacy-modes">
            <p className="docs-kicker">Core concepts</p>
            <h2>Privacy modes</h2>
            <div className="docs-data-table">
              <div><strong>Secret-sealed</strong><span>One-action encrypted voting. A proposal-specific secp256k1 public key seals each ballot, and committee approvals finalize a post-deadline tally.</span></div>
              <div><strong>Commit-reveal</strong><span>Contract-native fallback. A voter commits a hash during voting and must return during the reveal period with the original option and secret.</span></div>
            </div>
            <p>Secret-sealed voting improves participation ergonomics because voters do not return for a second transaction. Its confidentiality depends on correct election-key custody. Commit-reveal removes that decryption key but requires every counted voter to complete the reveal step.</p>
          </section>

          <section id="human-voting">
            <p className="docs-kicker">Human voting</p>
            <h2>Direct and one-time voting</h2>
            <h3>Direct secret-sealed ballot</h3>
            <ol>
              <li>The application reads the canonical proposal and 65-byte uncompressed election public key.</li>
              <li>The selected option is encrypted locally with ephemeral ECDH and AES-256-GCM.</li>
              <li>The envelope is bound to the chain, contract, proposal, and ballot owner.</li>
              <li>The voter wallet submits the ciphertext and deterministic proof hash directly.</li>
            </ol>
            <h3>One-time signed relay</h3>
            <p>The browser can prepare the same encrypted ballot and request a final EIP-712 signature. The resulting <code>cipherballot-signed-vote</code> packet is short-lived and immutable. An agent or service may relay it without receiving standing permission.</p>
            <h3>Commit-reveal fallback</h3>
            <p>The browser stores the reveal secret locally after commitment. The voter must return after voting closes and before the reveal deadline. Clearing browser storage without a backup can make that vote impossible to reveal.</p>
          </section>

          <section id="agent-voting">
            <p className="docs-kicker">Agent voting</p>
            <h2>Three explicit execution modes</h2>
            <div className="docs-data-table">
              <div><strong>Voter-signed</strong><span>The voter signs one final encrypted ballot. No standing delegation exists, and the ballot is attributed to the voter.</span></div>
              <div><strong>Delegated</strong><span>An authorized agent signs for one proposal or all proposals until an expiry. The ballot uses the voter’s one-vote allowance.</span></div>
              <div><strong>Public agent</strong><span>The agent signs and votes as itself on an open secret-sealed proposal. The ballot is attributed to the agent wallet.</span></div>
            </div>
            <p>A copied proposal brief is a public pointer, not voting authority:</p>
            <CodeBlock language="json">{`{
  "type": "cipherballot-agent-proposal",
  "version": 1,
  "chainId": "${BOT_CHAIN.chainId}",
  "contract": "${CONTRACT_ADDRESS || "0x..."}",
  "proposalId": "1",
  "proposalCode": "CB-XXXX-XXXX",
  "voter": "0x..."
}`}</CodeBlock>
            <p>The agent client rejects an unexpected chain, contract, proposal state, privacy mode, public key, or API/on-chain mismatch before it encrypts or signs.</p>
            <CodeBlock language="bash">{`npm run agent -- inspect '<proposal-brief-json>'
npm run agent -- vote-for-voter '<proposal-brief-json>' --option 0
npm run agent -- vote-as-agent '<proposal-brief-json>' --option 0
npm run agent -- submit-signed '<signed-vote-json>'
npm run agent -- status cb_RelayJobId`}</CodeBlock>
            <div className="docs-warning"><strong>Autonomy status</strong><p>The current release is agent-executable through briefs, a reusable client, CLI, and durable relay jobs. Persistent monitoring and unattended policy-based decisions are roadmap work.</p></div>
          </section>

          <section id="encryption">
            <p className="docs-kicker">Ballot encryption</p>
            <h2>Versioned authenticated envelopes</h2>
            <p>Every secret-sealed ballot creates a fresh ephemeral secp256k1 key pair. ECDH derives shared material, Keccak-256 derives an AES-256 key, and AES-GCM encrypts and authenticates the ballot payload.</p>
            <div className="docs-data-table">
              <div><strong>Envelope version</strong><span><code>cipherballot-ecdh-aesgcm-v1</code></span></div>
              <div><strong>Published fields</strong><span>Ephemeral public key, IV, ciphertext, authentication tag, and ciphertext commitment.</span></div>
              <div><strong>Associated context</strong><span>Chain ID, contract address, proposal ID, and ballot owner.</span></div>
              <div><strong>Contract proof</strong><span><code>keccak256("CipherBallot encrypted ballot proof v1" || privateBallotHash)</code></span></div>
              <div><strong>Maximum envelope</strong><span>4,096 bytes of encrypted ballot calldata.</span></div>
            </div>
            <p>Context binding prevents a valid envelope from being moved to another voter, proposal, contract, or chain. The API and committee tooling independently recompute these bindings.</p>
          </section>

          <section id="creating">
            <p className="docs-kicker">Operations</p>
            <h2>Create a proposal</h2>
            <ol>
              <li>Connect the creator wallet and confirm BOT Chain Testnet.</li>
              <li>Add a title and 2–8 unique, mutually exclusive options.</li>
              <li>Start immediately or schedule a future opening, then set the duration.</li>
              <li>Choose secret-sealed or commit-reveal privacy.</li>
              <li>For secret-sealed voting, add 2–16 committee addresses and a threshold of at least two.</li>
              <li>Generate the election security kit, download it, and store it offline before continuing.</li>
              <li>Choose public or allowlist eligibility and review every immutable setting.</li>
              <li>Publish the transaction, retain its explorer link, and copy the single committee portal link.</li>
              <li>Share the portal link privately with the listed committee members so they can confirm readiness.</li>
            </ol>
            <div className="docs-data-table">
              <div><strong>Title</strong><span>1–160 UTF-8 bytes.</span></div>
              <div><strong>Options</strong><span>2–8 unique values, each 1–96 UTF-8 bytes.</span></div>
              <div><strong>Allowlist</strong><span>Up to 128 unique, non-zero addresses.</span></div>
              <div><strong>Committee</strong><span>2–16 unique, non-zero addresses.</span></div>
              <div><strong>Threshold</strong><span>At least 2 and no greater than the committee size.</span></div>
            </div>
            <div className="docs-warning"><strong>Recovery kit</strong><p>The generated private key, tally secret, and committee handoff key exist only in the page until downloaded. Losing the kit can permanently prevent decryption or handoff recovery; exposing it can reveal ballots before the deadline.</p></div>
          </section>

          <section id="tallying">
            <p className="docs-kicker">Operations</p>
            <h2>Post-deadline committee tally</h2>
            <p>After the on-chain deadline, the creator imports the recovery-kit JSON once in the Committee Portal and releases an encrypted package. Only ciphertext is uploaded. Registered committee wallets use the original shared portal link to decrypt the package locally, reconstruct every ballot directly from BOT Chain, calculate the result, and generate the deterministic transcript and hash.</p>
            <ol>
              <li>Keep the recovery kit offline throughout voting. Committee members may confirm readiness without receiving its contents.</li>
              <li>After voting closes, the creator opens the Committee Portal and imports the recovery-kit JSON.</li>
              <li>The browser validates and encrypts the kit locally, then the creator signs a non-transaction authentication message and releases the ciphertext.</li>
              <li>Each registered committee member opens the original portal link, authenticates their assigned wallet, and selects <strong>Unlock tally</strong>.</li>
              <li>The browser decrypts the package locally and independently reconstructs the ballot set. The API never receives the handoff key or plaintext kit.</li>
              <li>The member reviews the option totals and selects <strong>Publish and approve result</strong>.</li>
              <li>The contract finalizes automatically when matching approvals reach the threshold.</li>
            </ol>
            <p>The portal uses <code>/api/v1/committee</code> for status, one-time wallet challenges, readiness receipts, creator release, committee retrieval, and revocation. The portal workspace and its entry points are shown only after the connected wallet is verified on-chain as the proposal creator or an assigned committee member. It does not use the agent API key. Every privileged request consumes a short-lived challenge and rechecks the signer&apos;s role against BOT Chain.</p>
            <div className="docs-warning"><strong>Privacy boundary</strong><p>Anyone who obtains both an authorized package and its handoff key can recover the election private key and decrypt individual ballots. Release remains deadline-gated, links should be shared only with the committee, and members must protect decrypted material. The current transcript hash proves evidence integrity, not cryptographic correctness of decryption; threshold decryption and public correctness proofs remain roadmap work.</p></div>
            <h3>Command-line fallback</h3>
            <p>The local tally command remains available when the browser publisher is unavailable. It enforces the same on-chain deadline and key-to-proposal checks.</p>
            <CodeBlock language="bash">{`cd app
ELECTION_PRIVATE_KEY=<OFFCHAIN_ELECTION_PRIVATE_KEY> \\
PROPOSAL_ID=1 \\
CIPHERBALLOT_CONTRACT_ADDRESS=${CONTRACT_ADDRESS || "0x..."} \\
DEPLOYMENT_BLOCK=<DEPLOYMENT_BLOCK> \\
npm run tally`}</CodeBlock>
            <p>Approvals are bound to the proposal ID, final tally, transcript URI, and transcript hash. A different payload is rejected with <code>TallyMismatch</code>.</p>
          </section>

          <section id="verification">
            <p className="docs-kicker">Operations</p>
            <h2>Results and protocol proof</h2>
            <p>The Results page lists finalized proposals and exposes the winning option, complete tally, participation, committee approval count, evidence URI, and transcript hash. The Proof page provides deployment identity and lifecycle-wide contract state.</p>
            <div className="docs-data-table">
              <div><strong>Contract identity</strong><span>Network, chain ID, configured address, deployed bytecode, and explorer source verification.</span></div>
              <div><strong>Participation</strong><span>Recorded ballot count and finalized tally total.</span></div>
              <div><strong>Committee evidence</strong><span>Threshold, approval count, tally hash, transcript URI, and proof hash.</span></div>
              <div><strong>Transaction evidence</strong><span>Creation, ballot, delegation, approval, and finalization events remain available through BOTScan.</span></div>
            </div>
            <p>A finalized result proves what the current contract accepted. It does not yet prove through zero knowledge that every encrypted ballot was decrypted and counted correctly.</p>
          </section>

          <section id="agent-api">
            <p className="docs-kicker">Reference</p>
            <h2>Agent API</h2>
            <p>All endpoints require <code>X-API-Key</code>. Production clients must use HTTPS. The API key protects relayer resources; ballot authority still comes from an on-chain delegation or a valid mode-specific signature.</p>
            <div className="docs-endpoints">
              <div><code>GET</code><strong>/api/v1/health</strong><span>Check contract, Redis, and FIFO queue readiness.</span></div>
              <div><code>GET</code><strong>/api/v1/proposals</strong><span>List up to 100 recent canonical proposals.</span></div>
              <div><code>GET</code><strong>/api/v1/proposals?proposalId=1</strong><span>Fetch one proposal and its election public key.</span></div>
              <div><code>GET</code><strong>/api/v1/proposals?proposalCode=CB-XXXX-XXXX</strong><span>Resolve a friendly reference to its canonical on-chain proposal.</span></div>
              <div><code>POST</code><strong>/api/v1/votes</strong><span>Validate, simulate, deduplicate, and enqueue a signed encrypted ballot.</span></div>
              <div><code>GET</code><strong>/api/v1/votes?jobId=cb_...</strong><span>Read queued, processing, submitted, confirmed, retrying, or failed state.</span></div>
              <div><code>GET</code><strong>/api/v1/votes?txHash=0x...</strong><span>Read pending, confirmed, or reverted transaction state.</span></div>
            </div>
            <h3>Discover a proposal</h3>
            <CodeBlock language="bash">{`curl "https://www.cipherballot.xyz/api/v1/proposals?proposalId=1" \\
  -H "X-API-Key: $AGENT_API_KEY"`}</CodeBlock>
            <h3>Submit a delegated ballot</h3>
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
            <p><code>voter-signed</code> omits <code>agent</code>. <code>public-agent</code> omits <code>voter</code>. Unknown fields, oversized requests, stale nonces, expired deadlines, malformed envelopes, invalid proof hashes, unauthorized signers, and failed contract simulations are rejected before queueing.</p>
            <h3>Accepted response</h3>
            <CodeBlock language="json">{`{
  "jobId": "cb_...",
  "status": "queued",
  "mode": "delegated",
  "ballotOwner": "0x...",
  "attempts": 0,
  "txHash": null,
  "blockNumber": null,
  "explorerUrl": null,
  "error": null,
  "statusUrl": "https://www.cipherballot.xyz/api/v1/votes?jobId=cb_..."
}`}</CodeBlock>
            <div className="docs-data-table">
              <div><strong>202</strong><span>Accepted, deduplicated, or still processing.</span></div>
              <div><strong>400 / 409</strong><span>Invalid request or a deterministic job that previously failed.</span></div>
              <div><strong>401 / 403</strong><span>Missing API key, unauthorized key, signer restriction, or disallowed origin.</span></div>
              <div><strong>413 / 415</strong><span>Body exceeds 16 KB or is not JSON.</span></div>
              <div><strong>429</strong><span>Client or ballot signer rate limit reached. Respect <code>Retry-After</code>.</span></div>
              <div><strong>503</strong><span>Contract, RPC, Redis, QStash, or relayer configuration is unavailable.</span></div>
            </div>
          </section>

          <section id="contract">
            <p className="docs-kicker">Reference</p>
            <h2>Contract reference</h2>
            <h3>Write methods</h3>
            <div className="docs-data-table contract-methods">
              <div><code>createProposal</code><span>Create a commit-reveal proposal.</span></div>
              <div><code>createThresholdProposal</code><span>Create a secret-sealed election with committee policy and a public encryption key.</span></div>
              <div><code>commitVote</code><span>Submit a commit-reveal commitment.</span></div>
              <div><code>submitPrivateBallot</code><span>Submit an encrypted ballot directly as its owner.</span></div>
              <div><code>setAgentDelegation</code><span>Authorize an agent until an expiry for one proposal or all proposals.</span></div>
              <div><code>revokeAgentDelegation</code><span>Deactivate the agent and invalidate its outstanding nonce.</span></div>
              <div><code>submitPrivateBallotByVoterSignature</code><span>Relay one final ballot signed directly by the voter.</span></div>
              <div><code>submitPrivateBallotByAgent</code><span>Relay an authorized agent ballot attributed to the voter.</span></div>
              <div><code>submitPublicAgentBallot</code><span>Relay an open-proposal ballot attributed to the agent.</span></div>
              <div><code>revealVote</code><span>Reveal a commit-reveal ballot after voting closes.</span></div>
              <div><code>approveThresholdTally</code><span>Approve one exact post-deadline tally payload.</span></div>
              <div><code>finalizeProposal</code><span>Finalize commit-reveal after all votes reveal or the reveal deadline passes.</span></div>
            </div>
            <h3>Read methods and nonce spaces</h3>
            <div className="docs-data-table contract-methods">
              <div><code>getProposal</code><span>Read metadata, timing, eligibility, participation, finalization, and tally.</span></div>
              <div><code>getPrivacyConfig</code><span>Read mode, committee policy, approvals, and evidence references.</span></div>
              <div><code>getEncryptionPublicKey</code><span>Read the secret-sealed proposal public key.</span></div>
              <div><code>getAgentDelegation</code><span>Read expiry, proposal scope, and active state.</span></div>
              <div><code>agentNonces</code><span>Delegated signature nonce per voter and agent pair.</span></div>
              <div><code>voterBallotNonces</code><span>One-time voter-signature nonce.</span></div>
              <div><code>publicAgentNonces</code><span>Public-agent signature nonce.</span></div>
              <div><code>isAllowed</code><span>Read public or allowlist eligibility for an address.</span></div>
            </div>
            <p>The EIP-712 domain is <code>CipherBallot</code>, version <code>2</code>, the active chain ID, and the deployed contract address.</p>
          </section>

          <section id="configuration">
            <p className="docs-kicker">Reference</p>
            <h2>Configuration</h2>
            <h3>Browser variables</h3>
            <CodeBlock language="dotenv">{`VITE_BOTCHAIN_RPC_URL=${BOT_CHAIN.rpcUrl}
VITE_BOTCHAIN_EXPLORER_URL=${BOT_CHAIN.explorerUrl}
VITE_CIPHERBALLOT_CONTRACT_ADDRESS=${CONTRACT_ADDRESS || "0x..."}`}</CodeBlock>
            <h3>Agent client variables</h3>
            <CodeBlock language="dotenv">{`BOTCHAIN_RPC_URL=${BOT_CHAIN.rpcUrl}
BOTCHAIN_CHAIN_ID=${BOT_CHAIN.chainId}
CIPHERBALLOT_CONTRACT_ADDRESS=${CONTRACT_ADDRESS || "0x..."}
AGENT_API_URL=https://www.cipherballot.xyz
AGENT_API_KEY=<API_KEY_OF_AT_LEAST_32_CHARACTERS>
AGENT_PRIVATE_KEY=<AGENT_SIGNING_KEY>
VOTER_ADDRESS=<ONLY_FOR_DELEGATED_MODE>
AGENT_VOTE_DEADLINE_SECONDS=900`}</CodeBlock>
            <h3>Server and relay variables</h3>
            <CodeBlock language="dotenv">{`BOTCHAIN_RPC_URL=${BOT_CHAIN.rpcUrl}
BOTCHAIN_CHAIN_ID=${BOT_CHAIN.chainId}
BOTCHAIN_EXPLORER_URL=${BOT_CHAIN.explorerUrl}
CIPHERBALLOT_CONTRACT_ADDRESS=${CONTRACT_ADDRESS || "0x..."}
RELAYER_PRIVATE_KEY=<FUNDED_DEDICATED_RELAYER_KEY>
RELAYER_EXPECTED_ADDRESS=<RELAYER_WALLET_ADDRESS>
AGENT_API_KEY=<RANDOM_KEY_OF_AT_LEAST_32_CHARACTERS>
AGENT_API_ALLOWED_ORIGIN=https://www.cipherballot.xyz
AGENT_API_ALLOWED_SIGNERS=<OPTIONAL_COMMA_SEPARATED_SIGNERS>
AGENT_API_RATE_LIMIT_PER_MINUTE=30
AGENT_SIGNER_RATE_LIMIT_PER_MINUTE=10
AGENT_VOTE_MAX_DEADLINE_SECONDS=3600
AGENT_RELAY_MAX_GAS=500000
KV_REST_API_URL=<REDIS_REST_URL>
KV_REST_API_TOKEN=<REDIS_WRITE_TOKEN>
QSTASH_TOKEN=<QSTASH_TOKEN>
QSTASH_CURRENT_SIGNING_KEY=<QSTASH_SIGNING_KEY>
QSTASH_NEXT_SIGNING_KEY=<QSTASH_NEXT_SIGNING_KEY>
QSTASH_QUEUE_NAME=cipherballot-relayer-v1
AGENT_RELAY_WORKER_URL=https://www.cipherballot.xyz/api/internal/relay-worker
AGENT_RELAY_PUBLIC_URL=https://www.cipherballot.xyz
TALLY_PUBLIC_URL=https://www.cipherballot.xyz
COMMITTEE_PORTAL_PUBLIC_URL=https://www.cipherballot.xyz`}</CodeBlock>
            <p><code>RELAYER_EXPECTED_ADDRESS</code> prevents an accidental key substitution. <code>AGENT_API_ALLOWED_SIGNERS</code> can restrict a closed pilot to approved voter and agent signing addresses.</p>
          </section>

          <section id="deployment">
            <p className="docs-kicker">Reference</p>
            <h2>Deployment</h2>
            <h3>Application and API</h3>
            <ol>
              <li>Import the repository into Vercel with <code>app</code> as the project root.</li>
              <li>Add browser, contract, relayer, Redis, and QStash variables to Production and Preview as appropriate.</li>
              <li>Configure a QStash FIFO queue with parallelism fixed at one.</li>
              <li>Set the public worker URL to <code>/api/internal/relay-worker</code>.</li>
              <li>Deploy, then call the authenticated health endpoint and confirm <code>status: ready</code>.</li>
            </ol>
            <h3>Contract</h3>
            <CodeBlock language="bash">{`forge create \\
  src/CipherBallotCommitReveal.sol:CipherBallotCommitReveal \\
  --rpc-url "$BOTCHAIN_RPC_URL" \\
  --private-key "$PRIVATE_KEY" \\
  --broadcast`}</CodeBlock>
            <h3>Source verification</h3>
            <CodeBlock language="bash">{`forge verify-contract <CONTRACT_ADDRESS> \\
  src/CipherBallotCommitReveal.sol:CipherBallotCommitReveal \\
  --chain-id ${BOT_CHAIN.chainId} \\
  --verifier blockscout \\
  --verifier-url ${BOT_CHAIN.explorerUrl}/api/ \\
  --watch`}</CodeBlock>
            <h3>Post-deployment checklist</h3>
            <ul>
              <li>Update both browser and server contract-address variables.</li>
              <li>Confirm the RPC chain ID and deployed bytecode.</li>
              <li>Verify source on BOTScan and record the deployment transaction.</li>
              <li>Confirm Redis writes, QStash signature verification, and queue parallelism.</li>
              <li>Fund only the dedicated relayer address and set a balance alert.</li>
              <li>Create and complete a low-stakes end-to-end proposal before announcing the deployment.</li>
            </ul>
          </section>

          <section id="testing">
            <p className="docs-kicker">Reference</p>
            <h2>Testing and validation</h2>
            <CodeBlock language="bash">{`# Contract suite
forge test --offline

# Browser/Node encryption compatibility
cd app
npm run test:crypto

# Proposal briefs and signed vote packets
npm run test:agent-client

# Redis idempotency, locks, and throttling
npm run test:relay-store

# Fresh contract + all three agent relay modes
npm run test:e2e

# Public-env check and production bundle
npm run build

# Production dependency audit
npm audit --omit=dev`}</CodeBlock>
            <p>The local E2E suite starts an ephemeral Anvil chain, deploys a fresh contract, relays delegated, voter-signed, and public-agent ballots, verifies retry deduplication, decrypts after the deadline, and finalizes through committee approvals.</p>
            <p>Pull requests are gated by the GitHub Actions check named <code>Contract, app, and agent checks</code>.</p>
          </section>

          <section id="troubleshooting">
            <p className="docs-kicker">Reference</p>
            <h2>Troubleshooting</h2>
            <div className="docs-data-table">
              <div><strong>Wrong network</strong><span>Use the header network control. Confirm chain ID <code>{BOT_CHAIN.chainId}</code> and that the wallet permits adding BOT Chain.</span></div>
              <div><strong>No proposals</strong><span>Verify the configured contract address, RPC availability, chain ID, and deployed bytecode.</span></div>
              <div><strong>Already voted</strong><span>One ballot is allowed per ballot owner. A delegated ballot consumes the voter’s allowance; a public-agent ballot consumes the agent’s.</span></div>
              <div><strong>Agent unauthorized</strong><span>Check active delegation, expiry, proposal scope, signer address, and the latest <code>agentNonces</code> value.</span></div>
              <div><strong>Stale signature</strong><span>Refresh canonical state and sign again. Revoking or replacing a delegation increments its nonce.</span></div>
              <div><strong>Public agent rejected</strong><span>The proposal must be open, active, secret-sealed, and not allowlist-restricted.</span></div>
              <div><strong>Relay API 429</strong><span>Respect <code>Retry-After</code>; client and signer throttles are independently enforced in Redis.</span></div>
              <div><strong>Relay API 503</strong><span>Check RPC, contract, relayer address, Redis, QStash credentials, worker URL, and queue state.</span></div>
              <div><strong>Tally blocked</strong><span>Confirm the deadline passed, recovery key matches the public key, deployment block is early enough, and every committee payload is identical.</span></div>
            </div>
          </section>

          <section id="security">
            <p className="docs-kicker">Security model</p>
            <h2>Safeguards and trust boundaries</h2>
            <div className="docs-data-table">
              <div><strong>On-chain enforcement</strong><span>Timing, eligibility, one ballot per owner, bounded inputs, delegation scope and expiry, nonce replay protection, signature separation, tally caps, and matching approvals.</span></div>
              <div><strong>Ballot client</strong><span>Fresh ephemeral material, authenticated encryption, proposal context binding, and deterministic ciphertext commitments.</span></div>
              <div><strong>Relay service</strong><span>Authentication, origin checks, body limits, signer limits, simulation, gas caps, durable jobs, distributed locks, and serialized submission.</span></div>
              <div><strong>Operator process</strong><span>Offline election-key custody, dedicated relayer funds, evidence review, committee independence, monitoring, and credential rotation.</span></div>
            </div>
            <div className="docs-warning"><strong>Election-key custody</strong><p>V2 uses one committee-custodied election private key. Whoever controls it can technically decrypt ballots before voting closes. True distributed key generation and threshold decryption are not implemented yet.</p></div>
            <div className="docs-warning"><strong>Tally correctness</strong><p>The contract requires matching threshold approval and prevents tally inflation, but it does not verify a zero-knowledge proof that every decryptable ballot was counted correctly.</p></div>
            <div className="docs-warning"><strong>Sybil resistance</strong><p>Public voting is one address per ballot, not one person per ballot. Use reviewed allowlists until credential, token, or membership modules are available.</p></div>
            <div className="docs-warning"><strong>Audit status</strong><p>The system has automated contract, cryptography, relay, and end-to-end tests but has not completed an independent production security audit. Report vulnerabilities privately through GitHub Security Advisories.</p></div>
          </section>

          <section id="roadmap">
            <p className="docs-kicker">Roadmap</p>
            <h2>Planned protocol work</h2>
            <ul>
              <li>Independent contract, cryptography, and relayer security review.</li>
              <li>Distributed key generation and true threshold decryption.</li>
              <li>Public proof verification for ballot validity and tally correctness.</li>
              <li>Persistent autonomous agent runner with policies, safe abstention, and decision receipts.</li>
              <li>Token, NFT, credential, and community membership eligibility modules.</li>
              <li>Event indexing, notifications, governance analytics, and richer audit history.</li>
              <li>Account abstraction, broader sponsorship controls, and mainnet community pilots.</li>
            </ul>
            <p>Roadmap items describe intended work, not capabilities available in the current deployment.</p>
            <div className="docs-callout"><strong>Start building</strong><p>Review an active decision, create a test proposal, or integrate the agent client against the deployed testnet contract.</p><div className="docs-callout-actions"><Link className="button-ghost" to="/voters">Explore proposals</Link><Link className="button-ghost" to="/creators">Create proposal</Link><Link className="button-ghost" to="/agents">Agent access</Link></div></div>
          </section>
        </article>

        <aside className="docs-toc" aria-label="On this page">
          <strong>On this page</strong>
          {allSections.map((item) => <a key={item.id} className={activeSection === item.id ? "active" : ""} href={`#${item.id}`}>{item.label}</a>)}
        </aside>
      </div>
    </section>
  );
}
