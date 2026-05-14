# CipherBallot

CipherBallot is a confidential voting application built on Solana, Anchor, and Arcium. It lets communities create governance proposals where votes are cast privately, tallied in encrypted shared state, and revealed only after the voting window closes.

The goal is simple: voters should be able to participate without exposing live vote choices or interim results before the final tally.

## Live Deployment

- App: https://www.cipherballot.xyz
- GitHub: https://github.com/Ololadestephen/CipherBallot
- Network: Solana Devnet
- Program ID: `833fAPgL1hjhonBa349E5UyGpP7dUdmiTELuJe3pbAXW`
- Circuit host: `https://www.cipherballot.xyz/circuits`

## Why CipherBallot

Most on-chain governance systems expose votes as soon as they are submitted. That creates real problems:

- Early voters can influence later voters.
- Whale voting behavior can be watched in real time.
- Communities may coordinate around partial results instead of voting independently.
- Sensitive internal decisions become observable before the voting window ends.

CipherBallot solves this by separating public settlement from private computation. Solana stores proposal state and final outcomes, while Arcium processes vote choices and tally updates as encrypted data.

## How It Works

1. A creator opens a proposal with a title, voting options, time window, and optional voter eligibility rules.
2. A voter connects a wallet and selects an option in the browser.
3. The frontend encrypts the vote for Arcium's MXE public key.
4. The Anchor program records that the wallet voted, but it never receives a plaintext `vote_index`.
5. Arcium runs the `apply_vote` encrypted circuit and updates encrypted tally state.
6. Before the deadline, public results remain hidden.
7. After the deadline, the creator finalizes the proposal.
8. Arcium runs `reveal_tally` and the program stores only the final plaintext totals on Solana.

## Arcium Integration

CipherBallot uses Arcium for the private parts of the voting lifecycle.

### Encrypted Circuits

The Arcis circuits live in `encrypted-ixs/src/lib.rs`.

- `init_tally` initializes encrypted tally state.
- `apply_vote` applies one encrypted vote to the encrypted tally.
- `reveal_tally` reveals final option counts after the proposal ends.

### Anchor Program Flow

The Anchor program lives in `programs/confidential_vote/src/lib.rs`.

- `create_proposal` creates public proposal metadata.
- `init_tally` queues Arcium tally initialization.
- `cast_vote` accepts encrypted vote material only.
- `apply_vote_callback` accepts verified Arcium output and stores updated encrypted tally state.
- `finalize_tally` queues final tally reveal after the deadline.
- `reveal_tally_callback` stores final results returned by Arcium.

### Privacy Benefits

- The program does not accept plaintext vote choices.
- Per-option vote counts are not stored publicly during voting.
- Double voting is prevented with a voter PDA.
- Results remain empty until the Arcium reveal callback completes.
- Final tally publication is driven by Arcium's callback flow and verified computation output.

## Off-Chain Circuit Storage

CipherBallot uses Arcium off-chain circuit sources instead of storing large circuit binaries directly on-chain. This avoids devnet callback failures caused by large on-chain circuit storage.

The compiled `.arcis` files are served publicly from the frontend deployment:

- `https://www.cipherballot.xyz/circuits/init_tally.arcis`
- `https://www.cipherballot.xyz/circuits/apply_vote.arcis`
- `https://www.cipherballot.xyz/circuits/reveal_tally.arcis`

The files are committed under:

```text
app/public/circuits/
```

To use another public host, rebuild the program with:

```bash
CIPHERBALLOT_CIRCUIT_BASE_URL=https://your-public-host/circuits anchor build
```

Existing Arcium computation definitions are immutable. If the circuit source URL changes, deploy a fresh program ID or fresh computation-definition namespace, then rerun the Arcium initialization script.

## Project Structure

```text
.
├── app/                         # Vite + React frontend
├── encrypted-ixs/               # Arcis encrypted circuits
├── programs/confidential_vote/   # Anchor program
├── tests/                       # Privacy and integration scaffolding
├── Anchor.toml
├── Arcium.toml
└── README.md
```

## Requirements

- Rust
- Solana CLI
- Anchor CLI `0.32.1`
- Node.js and npm
- Arcium tooling/client `0.9.7`

## Environment Variables

Frontend variables live in `app/.env`.

```bash
VITE_PROGRAM_ID=833fAPgL1hjhonBa349E5UyGpP7dUdmiTELuJe3pbAXW
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
VITE_ARCIUM_CLUSTER_OFFSET=456
```

For deployment, set the same values in Vercel.

## Local Setup

Install root dependencies:

```bash
npm install
```

Install frontend dependencies:

```bash
cd app
npm install
```

Run the frontend:

```bash
npm run dev
```

## Build

From the project root:

```bash
anchor build
```

Build encrypted circuits:

```bash
arcium build
```

Build the frontend:

```bash
cd app
npm run build
```

## Tests

Run the TypeScript privacy checks:

```bash
npm run test:ts
```

The test suite checks that:

- `cast_vote` accepts encrypted vote material only.
- vote tallying is queued through Arcium computations.
- callback output is verified before state changes.
- public results stay hidden until reveal.
- Arcis circuits mutate encrypted tally state and reveal only final counts.
- Arcium computation-definition initialization hooks are present.

## Devnet Deployment

Build with the public circuit host:

```bash
CIPHERBALLOT_CIRCUIT_BASE_URL=https://www.cipherballot.xyz/circuits anchor build
```

Deploy:

```bash
anchor deploy
```

Initialize Arcium MXE and computation definitions:

```bash
node tests/init_arcium.mjs
```

The init script creates the MXE account if needed and initializes computation definitions for:

- `init_tally`
- `apply_vote`
- `reveal_tally`

## Demo Flow

Creator flow:

1. Connect wallet.
2. Create a proposal.
3. Set voting options and deadline.
4. Initialize encrypted tally state.
5. Wait for voters to cast encrypted votes.
6. Finalize after the deadline.
7. Reveal final results.

Voter flow:

1. Connect wallet.
2. Open an active proposal.
3. Select an option.
4. Submit encrypted vote.
5. Wait for Arcium to apply the encrypted vote.
6. Return after deadline to view final results.

Privacy check:

- During voting, the app can show total encrypted votes, but not per-option results.
- Final option totals appear only after the Arcium reveal computation completes.

## Security Notes

CipherBallot is a devnet prototype built for the Arcium confidential governance track. It demonstrates the core privacy model, but should receive additional review before production use.

Current safeguards:

- No plaintext vote index in `cast_vote`.
- One vote per wallet per proposal.
- Final results blocked until the proposal deadline.
- Encrypted tally state used before reveal.
- Arcium callback path used for tally mutation and final reveal.

Recommended production hardening:

- Independent audit of Anchor account constraints.
- Stronger eligibility modules for token/NFT/community membership voting.
- More complete end-to-end tests against live Arcium callback delivery.
- Clear governance rules for proposal creation and upgrade authority.

## Submission Summary

CipherBallot demonstrates confidential governance on Solana using Arcium. Votes are encrypted before submission, tallied through encrypted computation, and revealed only after the voting window closes. This reduces early-vote influence while preserving the transparency of final on-chain results.

## License

MIT
