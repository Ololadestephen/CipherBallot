# BOT Chain Deployment Notes

CipherBallot is an EVM private governance app for BOT Chain with encrypted committee-sealed voting, delegated agent voting, and commit-reveal fallback.

## Network

- Chain ID: `968`
- RPC: `https://rpc.bohr.life`
- Explorer: `https://scan.bohr.life/`
- Native token: `BOT`

## Deployment

- Security-hardened agent-native contract: `0x3C250cBf439431D7dd8525Ca9800c577a9533e3C`
- Transaction: `0x656445179fecda3b26bbb925a15f40ceb0bc24e2cc33fa57556be359d144dd67`
- Deployment block: `19063989`
- Verified explorer: https://scan.bohr.life/address/0x3C250cBf439431D7dd8525Ca9800c577a9533e3C
- Source verification: BOTScan verified

Previous agent-native deployment: `0x8FA1B5439772a42BD8d9B545a8C3DfD54E828931`.

## Privacy Model

### Committee-Sealed Mode

1. The committee generates an election key pair and keeps the private key off-chain.
2. A proposal publishes the election public key with its options, window, committee, threshold, and tally secret commitment.
3. Voters and authorized agents encrypt choices locally with ephemeral ECDH and AES-256-GCM.
4. The contract records encrypted ballot commitments without publishing live choices.
5. After the deadline, committee tooling decrypts and verifies the ballots and produces a tally transcript.
6. Committee members approve the same final tally, transcript URI, tally proof hash, and tally secret on-chain.
7. The contract finalizes only after the approval threshold is reached.

### Commit-Reveal Fallback

During the voting window, the voter submits only a commitment:

```text
keccak256(abi.encode(proposalId, voter, optionIndex, secret))
```

After the voting window ends, voters reveal `optionIndex` and `secret`. The contract verifies the commitment and updates the final tally.

## Test

```bash
forge test --offline
```

## Deploy

Set environment variables:

```bash
cp .env.example .env
```

Then deploy with Foundry:

```bash
forge create \
  src/CipherBallotCommitReveal.sol:CipherBallotCommitReveal \
  --rpc-url "$BOTCHAIN_RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast
```

Save the deployed address in `CIPHERBALLOT_CONTRACT_ADDRESS` and `app/.env` as `VITE_CIPHERBALLOT_CONTRACT_ADDRESS`.

## Demo Script

1. Create a threshold proposal from the creator view.
2. Submit a private ballot from one voter wallet.
3. Show that only private ballot count is visible during the active window.
4. After the deadline, connect committee wallets and approve the same tally transcript.
5. Show finalization after the threshold approval count is reached.
6. Open the proof dashboard and result verification section.
