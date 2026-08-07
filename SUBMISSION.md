# CipherBallot Submission Notes

## Track

Open Track

Fallback track: EVM Deployment Track

## Project Summary

CipherBallot is a private governance app for BOT Chain. Communities can create proposals, voters submit private ballots once during the voting window, and a threshold committee approves the final tally with a shared tally secret after the deadline so live voting signals are not exposed.

Key features include secret-sealed threshold proposal mode, committee tally approvals, optional allowlist eligibility, a BOT Chain proof dashboard, commit-reveal fallback, and detailed result verification.

## Links

- GitHub: https://github.com/Ololadestephen/CipherBallot
- App: https://www.cipherballot.xyz
- BOT Chain explorer: https://scan.bohr.life/

### Current Security-Hardened Deployment

- Contract address: `0x3C250cBf439431D7dd8525Ca9800c577a9533e3C`
- Deployment transaction: `0x656445179fecda3b26bbb925a15f40ceb0bc24e2cc33fa57556be359d144dd67`
- Deployment block: `19063989`
- Verified contract: https://scan.bohr.life/address/0x3C250cBf439431D7dd8525Ca9800c577a9533e3C

### Previous Agent-Native Deployment (Historical)

- Contract address: `0x8FA1B5439772a42BD8d9B545a8C3DfD54E828931`
- Deployment transaction: `0x42e40618d51136a315b7f4bd9c913610b274182ce5d5d251ed511c9864890d77`

### Challenge V1 Deployment (Historical)

- Contract address: `0x1559C3a6B02E331307438D7839016EA5A827F467`
- Deployment transaction: `0xbf980106ddc84a21f933faa954a5bc809b361b21569e6e5aca00d92a8fa90329`
- Contract explorer: https://scan.bohr.life/address/0x1559C3a6B02E331307438D7839016EA5A827F467
- Transaction explorer: https://scan.bohr.life/tx/0xbf980106ddc84a21f933faa954a5bc809b361b21569e6e5aca00d92a8fa90329
- Demo video:
- X showcase post:

## Technical Write-Up

CipherBallot uses an EVM contract on BOT Chain with two privacy modes.

Recommended demo mode is secret-sealed threshold voting. A proposal creator sets committee addresses, a threshold, and a tally secret commitment. Voters submit one private ballot transaction during the active window. After the deadline, committee members independently approve the same final tally, transcript URI, tally proof hash, and shared tally secret on-chain. The contract finalizes only when approvals reach the threshold, and mismatched tally approvals are rejected.

The current contract additionally validates encrypted-ballot commitments, election public keys, bounded proposal inputs, and tally totals. Distributed key generation, threshold decryption, and ZK-backed tally correctness remain future cryptographic upgrades.

The fallback mode is commit-reveal.

During the active voting window, voters submit only:

```text
keccak256(abi.encode(proposalId, voter, optionIndex, secret))
```

The contract records the commitment and total participation count, but the selected option is not visible. After the deadline, voters reveal `optionIndex` and `secret`. The contract verifies the reveal against the stored commitment, increments the final tally, and rejects invalid reveals. A proposal can be finalized once all committed votes are revealed, or after the reveal period expires.

## Demo Checklist

1. Deploy `CipherBallotCommitReveal` to BOT Chain testnet.
2. Set `VITE_CIPHERBALLOT_CONTRACT_ADDRESS` in the frontend.
3. Create a secret-sealed threshold proposal with a short voting duration, committee addresses, threshold, and tally secret.
4. Optionally create an allowlist-only proposal to demonstrate eligibility controls.
5. Submit one private ballot from a voter wallet.
6. Show that no option tally is visible during voting.
7. After the deadline, connect committee wallets and approve the same tally transcript.
8. Show that finalization happens only after the approval threshold is reached.
9. Show the final tally, result verification section, proof dashboard, and explorer links.

## X Showcase Draft

CipherBallot is live on BOT Chain.

It is a private governance app where voters submit private ballots once, then a threshold committee approves a secret-sealed final tally after the deadline. No live vote choices, no single coordinator finalization.

Built for the BOT Chain Builder Challenge.

GitHub: https://github.com/Ololadestephen/CipherBallot
Demo: https://www.cipherballot.xyz

@BOTChain_ai
