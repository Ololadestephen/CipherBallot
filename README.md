# CipherBallot

CipherBallot is a private, agent-executable governance protocol on BOT Chain. Communities can create proposals, collect encrypted ballots without exposing live voting signals, and publish a committee-approved final tally after voting closes.

Human voters can participate directly or issue narrowly bounded voting instructions to agents. Agents can relay a one-time voter signature, act under an expiring on-chain delegation, or vote under their own identity on public proposals. Every relayed path uses mode-specific EIP-712 signatures and replay-protected nonces.

## Deployment

- Application: https://www.cipherballot.xyz
- Network: BOT Chain Testnet (`968`)
- Contract: [`0x3C250cBf439431D7dd8525Ca9800c577a9533e3C`](https://scan.bohr.life/address/0x3C250cBf439431D7dd8525Ca9800c577a9533e3C)
- Deployment transaction: [`0x656445179fecda3b26bbb925a15f40ceb0bc24e2cc33fa57556be359d144dd67`](https://scan.bohr.life/tx/0x656445179fecda3b26bbb925a15f40ceb0bc24e2cc33fa57556be359d144dd67)
- Source verification: BOTScan verified
- Repository: https://github.com/Ololadestephen/CipherBallot

CipherBallot is currently a BOT Chain testnet release. See [Security Model](#security-model) and [`SECURITY.md`](SECURITY.md) for its trust and cryptographic boundaries. Security-sensitive source changes require a fresh deployment; verify the deployed address before evaluating contract behavior.

The reviewer-ready BOT Chain materials are collected in [`docs/botchain-review/`](docs/botchain-review/README.md): mainnet readiness, deployment, security hardening, test evidence, and the proposed community governance pilot.

## Product Capabilities

- Secret-sealed proposals with locally encrypted, one-action ballots.
- No readable option totals during the active voting window.
- Committee threshold approval before a final tally becomes authoritative.
- A wallet-authenticated committee portal with readiness tracking and ciphertext-only recovery-kit handoff.
- Friendly deterministic proposal references while retaining canonical sequential on-chain IDs.
- Optional allowlist-only participation.
- Commit-reveal voting as a contract-native fallback.
- Direct wallet voting and three gas-sponsored agent execution modes.
- Scoped, expiring, and revocable on-chain agent delegation.
- Public agent participation under the agent's own wallet identity.
- EIP-712 signatures with separate nonce spaces for every relay mode.
- REST endpoints for proposal discovery, ballot relay, and transaction status.
- Pasteable proposal briefs, shared agent client, CLI, and agent skill.
- Proposal creation, voting, delegation, tallying, results, and proof interfaces.
- Verified BOT Chain contract and explorer-linked protocol activity.

## How Private Voting Works

### Secret-Sealed Proposals

1. The proposal operator creates a secp256k1 election key pair.
2. Only the election public key is published with the proposal. The private key remains in the committee's off-chain custody.
3. The voter selects an option in the browser or agent client.
4. A fresh ephemeral ECDH shared secret is derived for that ballot.
5. The choice is encrypted with AES-256-GCM and bound to the chain ID, contract address, proposal ID, and ballot owner.
6. The contract records the encrypted ballot commitment and participation count without publishing a readable choice.
7. The creator shares one committee portal link. Members authenticate their assigned wallets and confirm readiness without receiving the recovery kit.
8. After the deadline, the creator imports the recovery kit once. The browser validates and encrypts it locally, and only ciphertext is stored in Redis.
9. Committee members reopen the shared portal, authenticate, decrypt locally, and independently reconstruct the deterministic tally transcript.
10. Committee members approve the same tally hash on-chain. Finalization occurs only when the configured approval threshold is reached.

The encryption key and approval committee serve different purposes. Encryption protects choices during voting; threshold approval prevents one committee member from unilaterally finalizing a different result.

### Commit-Reveal Fallback

Commit-reveal proposals store this commitment during voting:

```text
keccak256(abi.encode(proposalId, voter, optionIndex, secret))
```

After voting closes, the voter reveals the option and secret. The contract verifies the commitment before adding the choice to the final tally.

## Voting Modes

| Mode | Ballot owner | Signer | Standing delegation | Gas payer |
| --- | --- | --- | --- | --- |
| Direct wallet | Voter | Voter transaction | No | Voter |
| One-time signed relay | Voter | Voter EIP-712 signature | No | Relayer |
| Delegated agent | Voter | Authorized agent | Yes, scoped and expiring | Relayer |
| Public agent | Agent | Agent | No | Relayer |

A public-agent ballot is always attributed to the agent wallet. It is not represented as a human voter's ballot. Public-agent voting is accepted only for open, secret-sealed proposals.

## Architecture

```text
React application
  |-- direct encrypted ballot --------------------------|
  |-- one-time voter-signed packet --> Agent API -------|--> BOT Chain contract
  |-- delegation management ----------------------------|

Agent client / CLI / skill
  |-- canonical proposal lookup
  |-- local ballot encryption
  |-- delegated or public-agent EIP-712 signature
  |-- authenticated relay request --> Agent API --------|

Committee tooling
  |-- post-deadline envelope recovery and validation
  |-- tally transcript generation
  |-- threshold approvals ------------------------------|--> Final result
```

### Contract

[`CipherBallotCommitReveal.sol`](src/CipherBallotCommitReveal.sol) owns proposal state, eligibility, duplicate-vote prevention, agent delegation, signature verification, nonce management, tally approvals, and finalization.

Core entry points:

```solidity
submitPrivateBallot(...)
submitPrivateBallotByVoterSignature(...)
submitPrivateBallotByAgent(...)
submitPublicAgentBallot(...)
setAgentDelegation(...)
revokeAgentDelegation(...)
approveThresholdTally(...)
```

### Application

The Vite and React application in [`app/`](app/) provides wallet connection, BOT Chain network switching, proposal authoring, encrypted voting, agent access management, committee operations, finalized results, protocol proofs, and documentation.

### Agent API

```text
GET  /api/v1/proposals
GET  /api/v1/health
POST /api/v1/votes
GET  /api/v1/votes?jobId=cb_...
GET  /api/v1/votes?txHash=0x...
```

The vote endpoint accepts ciphertext rather than a plaintext option. Before spending relayer gas it validates:

- the execution mode and required addresses;
- the encrypted envelope structure and size;
- the ballot proof commitment;
- the signature nonce and deadline;
- delegation scope and expiry when applicable;
- the mode-specific EIP-712 signature through contract simulation.

Accepted ballots receive a deterministic relay `jobId`. Redis persists the encrypted request and execution state, while a QStash FIFO queue invokes one signed worker request at a time. Agents can poll the job until it is confirmed or fails. Duplicate submissions return the existing job instead of spending gas twice.

The API key protects relayer resources; it does not grant voting authority. Authority comes from the voter or agent signature and, in delegated mode, the on-chain delegation.

## Agent Integration

### Proposal Briefs

The **Copy for agent** action creates a public pointer:

```json
{
  "type": "cipherballot-agent-proposal",
  "version": 1,
  "chainId": "968",
  "contract": "0x3C250cBf439431D7dd8525Ca9800c577a9533e3C",
  "proposalId": "1",
  "proposalCode": "CB-XXXX-XXXX",
  "voter": "0x..."
}
```

The brief contains no option or private key. An agent must use it to fetch and verify the canonical proposal before acting.

For a one-time relayed vote, the voter selects an option and uses **Sign one-time agent vote**. The browser encrypts the choice, requests an EIP-712 wallet signature, and copies a short-lived `cipherballot-signed-vote` packet. The agent can relay that exact ballot but cannot alter its owner, proposal, ciphertext, proof hash, nonce, or deadline.

### CLI

Run commands from `app/`:

```bash
npm run agent -- inspect '<proposal-brief-json>'
npm run agent -- vote-for-voter '<proposal-brief-json>' --option 0
npm run agent -- vote-as-agent '<proposal-brief-json>' --option 0
npm run agent -- submit-signed '<signed-vote-json>'
npm run agent -- status cb_RelayJobId
npm run agent -- status 0xTransactionHash
```

The reusable client is in [`app/examples/lib/agent-client.mjs`](app/examples/lib/agent-client.mjs), and the execution instructions are in [`.agents/skills/cipherballot-agent/SKILL.md`](.agents/skills/cipherballot-agent/SKILL.md).

The current release is agent-executable, not fully unattended. Persistent proposal monitoring, policy-based decision engines, and autonomous scheduling remain roadmap work.

## Local Development

### Requirements

- Node.js 20 or newer
- npm
- Foundry (`forge`, `cast`, and `anvil`)
- An EVM wallet for browser workflows

### Install and Run

```bash
cd app
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173/`.

### Browser Environment

```dotenv
VITE_BOTCHAIN_RPC_URL=https://rpc.bohr.life
VITE_BOTCHAIN_EXPLORER_URL=https://scan.bohr.life
VITE_CIPHERBALLOT_CONTRACT_ADDRESS=0x3C250cBf439431D7dd8525Ca9800c577a9533e3C
```

Only public values may use the `VITE_` prefix.

### Server Environment

```dotenv
BOTCHAIN_RPC_URL=https://rpc.bohr.life
BOTCHAIN_CHAIN_ID=968
BOTCHAIN_EXPLORER_URL=https://scan.bohr.life
CIPHERBALLOT_CONTRACT_ADDRESS=0x3C250cBf439431D7dd8525Ca9800c577a9533e3C
RELAYER_PRIVATE_KEY=<FUNDED_DEDICATED_RELAYER_KEY>
RELAYER_EXPECTED_ADDRESS=<RELAYER_WALLET_ADDRESS>
AGENT_API_KEY=<RANDOM_VALUE_OF_AT_LEAST_32_CHARACTERS>
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
AGENT_RELAY_PUBLIC_URL=https://www.cipherballot.xyz
COMMITTEE_PORTAL_PUBLIC_URL=https://www.cipherballot.xyz
```

Never expose the relayer key, agent key, API key, election private key, tally secret, or any wallet private key through a `VITE_` variable.

## Election Operations

### Generate an Election Kit

```bash
cd app
npm run keygen
```

The command writes a timestamped, owner-readable election-kit file and prints only its path and public key. Publish only `encryptionPublicKey`. Store the kit outside the frontend, API, repository, and deployment environment.

### Produce a Post-Deadline Tally

```bash
ELECTION_PRIVATE_KEY=<OFFCHAIN_ELECTION_PRIVATE_KEY> \
PROPOSAL_ID=1 \
CIPHERBALLOT_CONTRACT_ADDRESS=0x3C250cBf439431D7dd8525Ca9800c577a9533e3C \
DEPLOYMENT_BLOCK=19063989 \
npm run tally
```

The tally command refuses to decrypt before the proposal deadline. It verifies the chain, deployed contract, election key, complete event count, supported submission method, unique ballot owner, proposal context, ciphertext commitment, and proof hash before counting an envelope.

## Testing

Contract tests:

```bash
forge test --offline
```

Cryptography and packet-format tests:

```bash
cd app
npm run test:crypto
npm run test:agent-client
npm run test:relay-store
npm run test:tally-transcript
npm run test:committee-handoff
```

Full relay lifecycle on an ephemeral Anvil chain:

```bash
cd app
npm run test:e2e
```

The E2E suite deploys a fresh contract, submits delegated, voter-signed, and public-agent encrypted ballots through the API, deduplicates an exact retry, decrypts after the deadline, and finalizes through two committee approvals.

Production build:

```bash
cd app
npm run build
```

## Contract Deployment

Configure the root `.env`, then deploy:

```bash
forge create \
  src/CipherBallotCommitReveal.sol:CipherBallotCommitReveal \
  --rpc-url "$BOTCHAIN_RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast
```

After deployment, update both server and browser contract-address variables. Source verification can be submitted to the BOTScan Blockscout endpoint:

```bash
forge verify-contract <CONTRACT_ADDRESS> \
  src/CipherBallotCommitReveal.sol:CipherBallotCommitReveal \
  --chain-id 968 \
  --verifier blockscout \
  --verifier-url https://scan.bohr.life/api/ \
  --watch
```

## Security Model

Current safeguards include:

- one ballot per owner per proposal;
- proposal timing and allowlist enforcement on-chain;
- bounded and unambiguous proposal, ballot, and tally inputs;
- on-curve secp256k1 election public keys;
- deterministic ballot-proof validation enforced by the contract;
- a final tally total capped by the recorded ballot count;
- locally generated ephemeral encryption material for every ballot;
- AES-GCM authenticated data bound to the chain, contract, and proposal;
- low-`s` ECDSA enforcement for EIP-712 signatures;
- separate signature types and nonce spaces for delegated, voter-signed, and public-agent ballots;
- delegation scope, expiry, revocation, and nonce invalidation;
- API request-size, envelope-size, origin, authentication, rate, and deadline checks;
- Redis-backed API and signer throttling, idempotent relay jobs, and distributed execution locks;
- a QStash-authenticated FIFO worker with one active relay at a time;
- optional relay-signer allowlisting and transaction gas caps;
- contract simulation before the relayer broadcasts a transaction;
- matching tally hashes across committee approvals;
- blocked finalization while voting is active.

### Trust Boundaries

- **Election key custody:** The proposal recovery kit is held offline by the named creator/custodian. CipherBallot enables kit import and encrypted committee handoff only after the on-chain voting deadline; distributed key shares are planned for the production threshold-cryptography release.
- **Threshold semantics:** The smart contract enforces threshold approval of one final tally. It does not yet implement distributed key generation or true threshold decryption.
- **Tally verification:** Committee members validate and approve the tally transcript. A public zero-knowledge proof of correct decryption and tallying is not yet enforced on-chain.
- **Relayer coordination:** Redis persists jobs, throttles, and locks across serverless instances. QStash delivers jobs through one FIFO queue, and the worker reconciles submitted transactions before retrying. Operational monitoring, spending alerts, and provider availability remain deployment responsibilities.
- **Review status:** The contract and relayer have automated test coverage. Independent review is a planned milestone before expansion into binding or high-value governance.
- **Dependency status:** React Router is on the patched v7 line and the production dependency audit currently reports zero known vulnerabilities.

The current release is designed for controlled, non-binding pilots. Independent security review, distributed threshold decryption, and public tally-verification proofs are the planned milestones for expanding into binding or high-value governance.

## Roadmap

- Independent contract, cryptography, and relayer security review.
- Distributed key generation and threshold decryption.
- Public proof verification for decrypted ballots and final tallies.
- Persistent agent runner with user-defined policies, safe abstention, and auditable decision receipts.
- Token, NFT, and community membership eligibility modules.
- Event indexing, notifications, and richer governance analytics.
- Account abstraction and broader gas sponsorship controls.
- Mainnet deployment and community governance pilots.

## Repository Layout

```text
.
|-- app/                         # React application, API routes, agent client, and tooling
|-- src/                         # Solidity contract
|-- test/                        # Foundry contract tests
|-- .agents/skills/              # Agent execution instructions
|-- BOTCHAIN.md                  # BOT Chain deployment record
|-- foundry.toml                 # Foundry configuration
`-- README.md
```

## License

MIT
