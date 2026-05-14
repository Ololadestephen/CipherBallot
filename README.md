# CipherBallot

CipherBallot is a confidential governance prototype on Solana using Arcium encrypted circuits. It is designed for polls where individual votes should not be visible before the voting window closes.

## What It Does

- Creators open governance proposals with multiple options.
- Voters submit encrypted vote payloads from the browser.
- Solana stores proposal metadata, eligibility state, voter records, and final revealed results.
- Arcium circuits define the private tally lifecycle: initialize tally, apply encrypted vote, and reveal final tally after the deadline.

## Why Arcium

Public governance has a common problem: early visible votes influence later voters, and large wallets can be watched in real time. CipherBallot uses Arcium so vote choices can be processed as encrypted data instead of public transaction data.

The intended privacy model is:

1. The browser encrypts the selected vote with the Arcium MXE public key.
2. The Anchor program accepts only encrypted vote material.
3. The encrypted tally is updated through the `apply_vote` encrypted circuit.
4. Final plaintext results are written on-chain only after the voting deadline through the reveal callback path.

## Current Privacy Guardrails

The program no longer accepts a plaintext `vote_index` in `cast_vote`. During voting:

- `proposal.vote_count` can increase publicly.
- `proposal.results` stays empty.
- Individual option counts are not stored on-chain.
- A PDA voter record prevents double voting.
- Final results can only appear through `reveal_tally_callback` after `finalize_tally` requests reveal.

## Project Structure

```text
.
├── programs/confidential_vote      # Anchor program
├── encrypted-ixs                  # Arcis encrypted circuits
├── app                            # Vite + React frontend
├── tests                          # Anchor privacy-flow tests
├── Anchor.toml
├── Arcium.toml
└── README.md
```

## Core Instructions

- `create_proposal` creates a proposal and stores metadata.
- `init_tally` stores the initial encrypted tally state.
- `cast_vote` records an encrypted vote packet and creates the voter record. It does not accept plaintext vote choice.
- `apply_vote_callback` stores the updated encrypted tally returned by the private computation path.
- `finalize_tally` requests final reveal after the proposal deadline.
- `reveal_tally_callback` stores final plaintext results after reveal.

## Encrypted Circuits

The circuits are in `encrypted-ixs/src/lib.rs`:

- `init_tally` converts a shared encrypted initial tally into MXE-owned encrypted state.
- `apply_vote` applies one encrypted vote to the encrypted tally.
- `reveal_tally` reveals final option counts after tally completion.

## Requirements

- Rust
- Solana CLI
- Anchor CLI `0.32.1`
- Node.js
- Arcium CLI / client `0.9.7`

The current checked-in devnet program ID is:

```text
8iVLYf7779wxNiYDPhFYmspQ2UuE3rcmxEARFbAfuff4
```

## Local Setup

```bash
npm install
cd app
npm install
```

## Build

```bash
anchor build
```

Build encrypted circuits:

```bash
arcium build
```

## Tests

```bash
npm run test:ts
```

The tests cover the current privacy contract:

- `cast_vote` accepts encrypted vote material only,
- vote tallying is queued through Arcium computations,
- callbacks verify signed Arcium output before state changes,
- public results stay empty until `reveal_tally_callback`,
- Arcis circuits mutate encrypted tally state and reveal only final counts,
- all Arcium computation definition initialization hooks are exposed.

## Devnet Deployment Note

The current devnet program is deployed at `8iVLYf7779wxNiYDPhFYmspQ2UuE3rcmxEARFbAfuff4`. The Arcium computation definitions for `init_tally`, `apply_vote`, and `reveal_tally` have been initialized and finalized for that program.

## Frontend

The frontend lives in `app/`.

```bash
cd app
npm run dev
```

Useful environment variables:

```bash
VITE_PROGRAM_ID=8iVLYf7779wxNiYDPhFYmspQ2UuE3rcmxEARFbAfuff4
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
```

## Submission Summary

CipherBallot demonstrates confidential governance with Solana for public settlement and Arcium for encrypted vote processing. The project focuses on preventing early vote visibility, reducing voter influence, and publishing only final governance outcomes on-chain.

## License

MIT
