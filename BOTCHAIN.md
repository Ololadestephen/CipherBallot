# BOT Chain Deployment Notes

CipherBallot is an EVM private governance app for BOT Chain with secret-sealed threshold voting and commit-reveal fallback.

## Network

- Chain ID: `968`
- RPC: `https://rpc.bohr.life`
- Explorer: `https://scan.bohr.life/`
- Native token: `BOT`

## Deployment

- Contract: `0x1559C3a6B02E331307438D7839016EA5A827F467`
- Transaction: `0xbf980106ddc84a21f933faa954a5bc809b361b21569e6e5aca00d92a8fa90329`
- Explorer: https://scan.bohr.life/address/0x1559C3a6B02E331307438D7839016EA5A827F467

## Privacy Model

### Secret-Sealed Threshold Mode

1. A proposal is created with 2-8 voting options, a voting window, committee members, threshold, and a tally secret commitment.
2. A voter submits one private ballot transaction during the active window.
3. After the deadline, committee members review the tally transcript.
4. Committee members approve the same final tally, transcript URI, tally proof hash, and tally secret on-chain.
5. The contract finalizes only after the approval threshold is reached.

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
