# CipherBallot

CipherBallot is a private governance app migrated to BOT Chain for the BOT Chain Builder Challenge. It helps communities create proposals, collect private voting signals during the voting window, and publish a verifiable final tally only after the vote has closed.

The project was originally a private voting experiment. For this challenge it has been rebuilt as a pure EVM application on BOT Chain, with a Solidity contract, React frontend, BOT Chain proof dashboard, secret-sealed threshold voting, and commit-reveal fallback.

## Live Deployment

- App: https://www.cipherballot.xyz
- GitHub: https://github.com/Ololadestephen/CipherBallot
- Contract: `0x1559C3a6B02E331307438D7839016EA5A827F467`
- Deployment transaction: `0xbf980106ddc84a21f933faa954a5bc809b361b21569e6e5aca00d92a8fa90329`
- Contract explorer: https://scan.bohr.life/address/0x1559C3a6B02E331307438D7839016EA5A827F467
- Transaction explorer: https://scan.bohr.life/tx/0xbf980106ddc84a21f933faa954a5bc809b361b21569e6e5aca00d92a8fa90329

## BOT Chain

- Network: BOT Chain testnet
- Chain ID: `968`
- RPC: `https://rpc.bohr.life`
- Explorer: `https://scan.bohr.life`
- Native token: `BOT`

## Why It Matters

Most on-chain governance exposes votes as soon as they are submitted. That can influence later voters, reveal large-holder behavior in real time, and turn sensitive decisions into public coordination games before the voting window closes.

CipherBallot focuses on a simple product goal:

> Let voters participate without exposing live option tallies before the final result.

## Privacy Modes

### Secret-Sealed Threshold Voting

This is the recommended demo path.

1. A creator creates a proposal with options, a voting window, committee addresses, an approval threshold, and a tally secret.
2. The frontend hashes the tally secret locally and sends only the secret commitment to the contract.
3. Voters submit one private ballot transaction during the active voting window.
4. The contract records participation, but no live option tally is published.
5. After the deadline, committee members review the tally transcript.
6. Committee members approve the same final tally using the shared tally secret.
7. The contract finalizes only when the approval threshold is reached.
8. Mismatched tally approvals are rejected.

Important: V1 uses a shared tally secret for practical challenge delivery. The secret is committed at proposal creation and revealed only during post-deadline tally approval. V2 upgrades this layer to full threshold encryption, distributed key generation, and proof-backed tally verification.

### Commit-Reveal Fallback

CipherBallot also supports classic EVM commit-reveal voting:

```text
keccak256(abi.encode(proposalId, voter, optionIndex, secret))
```

Voters commit during the voting window, then reveal `optionIndex` and `secret` after the deadline. The contract verifies the reveal before updating the tally.

## Features

- EVM-only BOT Chain deployment.
- Wallet connect with automatic BOT Chain add/switch support.
- Secret-sealed threshold proposal creation.
- One-action private ballot submission for threshold proposals.
- Committee tally approval workbench.
- Optional allowlist-only proposals.
- Commit-reveal fallback mode.
- BOT Chain proof dashboard showing live contract/proposal data.
- Result verification page with contract links, tally status, deadlines, and accounting.
- Technical write-up inside the app.

## Project Structure

```text
.
├── app/                         # Vite + React frontend
├── src/                         # Solidity contract
├── test/                        # Foundry tests
├── BOTCHAIN.md                  # Deployment and demo notes
├── SUBMISSION.md                # Challenge submission notes
├── foundry.toml
└── README.md
```

## Local Setup

Install frontend dependencies:

```bash
cd app
npm install
```

Run the frontend:

```bash
npm run dev
```

Open:

```text
http://localhost:5173/
```

## Environment

Root `.env`:

```bash
BOTCHAIN_RPC_URL=https://rpc.bohr.life
BOTCHAIN_CHAIN_ID=968
PRIVATE_KEY=
CIPHERBALLOT_CONTRACT_ADDRESS=0x1559C3a6B02E331307438D7839016EA5A827F467
```

Frontend `app/.env`:

```bash
VITE_BOTCHAIN_RPC_URL=https://rpc.bohr.life
VITE_BOTCHAIN_EXPLORER_URL=https://scan.bohr.life
VITE_CIPHERBALLOT_CONTRACT_ADDRESS=0x1559C3a6B02E331307438D7839016EA5A827F467
```

## Tests

Run Solidity tests:

```bash
forge test --offline
```

Current test coverage checks:

- proposal creation with 2-8 options;
- duplicate vote prevention;
- allowlist eligibility enforcement;
- commit-reveal validation;
- reveal/finalization timing;
- invalid reveal rejection;
- secret-sealed threshold finalization;
- rejection of mismatched committee tally approvals.

Build the frontend:

```bash
cd app
npm run build
```

## Deploy

```bash
forge create \
  src/CipherBallotCommitReveal.sol:CipherBallotCommitReveal \
  --rpc-url "$BOTCHAIN_RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast
```

After deployment, set:

- `CIPHERBALLOT_CONTRACT_ADDRESS`
- `VITE_CIPHERBALLOT_CONTRACT_ADDRESS`

## Demo Flow

Creator:

1. Connect wallet.
2. Add or switch to BOT Chain.
3. Create a secret-sealed threshold proposal.
4. Add committee addresses and threshold.
5. Set a short voting duration for demo.
6. Share the proposal.

Voter:

1. Connect wallet.
2. Open an active proposal.
3. Select an option.
4. Submit one private ballot.
5. Confirm that no option tally is visible during voting.

Committee:

1. Wait until the voting deadline passes.
2. Open the proposal result page.
3. Enter the agreed tally values, transcript URI, tally proof hash, and tally secret.
4. Approve with committee wallets until the threshold is reached.
5. View the finalized result and BOT Chain proof links.

## Security Notes

CipherBallot is a testnet prototype for BOT Chain Builder Challenge #1. It is designed to demonstrate a credible privacy-preserving governance flow, not to replace a production-audited voting system yet.

Current safeguards:

- The plain tally secret is not sent during proposal creation; the frontend sends `keccak256(secret)`.
- One wallet can submit only one ballot per proposal.
- Threshold proposals require at least two committee members and threshold of at least two.
- Finalization requires enough committee approvals.
- Tally approvals must match the same tally hash.
- Commit-reveal votes cannot be revealed before the voting deadline.
- Finalization is blocked while voting is active.

## Challenge Summary

CipherBallot demonstrates a BOT Chain-native private governance workflow: private ballot submission, no live option tally, threshold committee finalization, and verifiable on-chain results. It is an existing project migrated and upgraded into a pure EVM BOT Chain application for the Builder Challenge.

## License

MIT
