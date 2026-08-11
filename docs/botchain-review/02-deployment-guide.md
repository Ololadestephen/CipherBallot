# Deployment Guide

This guide covers the current BOT Chain testnet and mainnet deployments and the procedure for promoting a verified release. CipherBallot contracts are immutable and non-upgradeable; contract changes require a new deployment and updated application configuration.

## Architecture

| Component | Responsibility |
| --- | --- |
| `CipherBallotCommitReveal` | Proposal state, timing, eligibility, ballots, delegation, nonces, tally approvals, and finalization |
| React/Vite DApp | Wallet workflows, local encryption, voting, committee portal, results, proof, and documentation |
| Vercel API functions | Proposal discovery, vote validation, tally transcript publication, committee authentication, and job status |
| Upstash Redis | Durable relay state, idempotency, rate limits, locks, committee readiness, and encrypted handoff storage |
| Upstash QStash | Signature-authenticated FIFO delivery to one serialized relay worker |
| BOT Chain RPC/explorer | Chain reads, transaction submission, source verification, and public evidence |

## Current Testnet Deployment

```text
Network: BOT Chain testnet
Chain ID: 968
RPC: https://rpc.bohr.life
Explorer: https://scan.bohr.life
Contract: 0x3C250cBf439431D7dd8525Ca9800c577a9533e3C
Deployment block: 19063989
```

The deployment transaction and verified contract are linked from the [package index](README.md).

## Current Mainnet Deployment

```text
Network: BOT Chain mainnet
Chain ID: 677
RPC: https://rpc.botchain.ai
Explorer: https://scan.botchain.ai
Contract: 0x1559C3a6B02E331307438D7839016EA5A827F467
Deployment transaction: 0xddcfcb980c2f700accccd2f7eb3482f7b63444c38cea48cc1ddbc7dad47cca36
Deployment block: 19263053
Runtime bytecode hash: 0xdd02e913a2113e1f1ebe3fc360452b6947daac85d0f0543ad881a5bd7e55afab
```

The mainnet source is verified with Solidity `0.8.24`, optimizer `200`, and `via_ir=true`. The deployed runtime bytecode exactly matches the release artifact built from commit `6653cad`.

## Prerequisites

- Node.js 22 or newer for CI/production parity.
- npm and the committed `app/package-lock.json`.
- Foundry with `forge`, `cast`, and `anvil`.
- A dedicated deployer wallet.
- A separate dedicated relayer wallet with a capped native-token balance.
- Vercel project access.
- Upstash Redis database and QStash account.
- Confirmed BOT Chain RPC, chain ID, explorer, and source-verifier settings.
- Three committee wallets for the recommended 2-of-3 pilot threshold.

## 1. Validate The Release

```bash
forge test --offline

cd app
npm ci
npm run test:crypto
npm run test:agent-client
npm run test:relay-store
npm run test:tally-transcript
npm run test:committee-handoff
npm run test:e2e
npm run build
npm audit --omit=dev
```

Record the Git commit, command outputs, and reviewer in the release ticket.

## 2. Configure Contract Deployment

Create the root `.env` locally. Never commit it.

```dotenv
BOTCHAIN_RPC_URL=<BOT_CHAIN_MAINNET_RPC>
BOTCHAIN_CHAIN_ID=<BOT_CHAIN_MAINNET_CHAIN_ID>
PRIVATE_KEY=<DEDICATED_DEPLOYER_PRIVATE_KEY>
CIPHERBALLOT_CONTRACT_ADDRESS=
```

Confirm the deployer address and balance before broadcasting:

```bash
cast wallet address --private-key "$PRIVATE_KEY"
cast balance <DEPLOYER_ADDRESS> --rpc-url "$BOTCHAIN_RPC_URL"
cast chain-id --rpc-url "$BOTCHAIN_RPC_URL"
```

## 3. Deploy The Contract

```bash
forge create \
  src/CipherBallotCommitReveal.sol:CipherBallotCommitReveal \
  --rpc-url "$BOTCHAIN_RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast
```

Record:

- contract address;
- deployment transaction and block;
- deployer address;
- Git commit;
- compiler `0.8.24`, optimizer `200`, and `via_ir=true` settings.

## 4. Verify Source

Use the BOT Chain Blockscout-compatible verifier:

```bash
forge verify-contract <CONTRACT_ADDRESS> \
  src/CipherBallotCommitReveal.sol:CipherBallotCommitReveal \
  --chain-id <BOT_CHAIN_MAINNET_CHAIN_ID> \
  --verifier blockscout \
  --verifier-url <BOT_CHAIN_MAINNET_EXPLORER_API>/ \
  --watch
```

Do not configure the DApp for public use until the explorer shows verified source and the runtime bytecode is independently checked.

## 5. Configure The Application

Public browser variables:

```dotenv
VITE_BOTCHAIN_RPC_URL=<MAINNET_RPC>
VITE_BOTCHAIN_EXPLORER_URL=<MAINNET_EXPLORER>
VITE_CIPHERBALLOT_CONTRACT_ADDRESS=<NEW_CONTRACT_ADDRESS>
VITE_CIPHERBALLOT_DEPLOYMENT_BLOCK=<DEPLOYMENT_BLOCK>
```

Server-only variables:

```dotenv
BOTCHAIN_RPC_URL=<MAINNET_RPC>
BOTCHAIN_CHAIN_ID=<MAINNET_CHAIN_ID>
BOTCHAIN_EXPLORER_URL=<MAINNET_EXPLORER>
CIPHERBALLOT_CONTRACT_ADDRESS=<NEW_CONTRACT_ADDRESS>
RELAYER_PRIVATE_KEY=<NEW_MAINNET_RELAYER_KEY>
RELAYER_EXPECTED_ADDRESS=<MAINNET_RELAYER_ADDRESS>
AGENT_API_KEY=<RANDOM_SECRET_AT_LEAST_32_CHARACTERS>
AGENT_API_ALLOWED_ORIGIN=https://www.cipherballot.xyz
AGENT_API_ALLOWED_SIGNERS=<OPTIONAL_PILOT_SIGNER_ALLOWLIST>
AGENT_API_RATE_LIMIT_PER_MINUTE=30
AGENT_SIGNER_RATE_LIMIT_PER_MINUTE=10
AGENT_VOTE_MAX_DEADLINE_SECONDS=3600
AGENT_RELAY_MAX_GAS=500000
KV_REST_API_URL=<REDIS_REST_URL>
KV_REST_API_TOKEN=<REDIS_WRITE_TOKEN>
QSTASH_TOKEN=<QSTASH_TOKEN>
QSTASH_CURRENT_SIGNING_KEY=<QSTASH_CURRENT_KEY>
QSTASH_NEXT_SIGNING_KEY=<QSTASH_NEXT_KEY>
QSTASH_QUEUE_NAME=cipherballot-relayer-mainnet-v1
AGENT_RELAY_WORKER_URL=https://www.cipherballot.xyz/api/internal/relay-worker
AGENT_RELAY_PUBLIC_URL=https://www.cipherballot.xyz
TALLY_PUBLIC_URL=https://www.cipherballot.xyz
COMMITTEE_PORTAL_PUBLIC_URL=https://www.cipherballot.xyz
```

Never use the `VITE_` prefix for private keys, API keys, election material, Redis tokens, or QStash credentials. Use separate Production and Preview credentials.

## 6. Configure Redis And QStash

1. Create a production Redis database isolated from Preview.
2. Configure both REST URL and write token.
3. Create a unique QStash queue name for mainnet.
4. Confirm the application upserts queue parallelism to `1`.
5. Confirm the worker URL is HTTPS and exactly `/api/internal/relay-worker`.
6. Confirm unsigned worker requests return `401`.
7. Configure dead-letter, queue-lag, and delivery-failure alerts.

## 7. Deploy And Verify The DApp

Deploy the merged `main` commit through Vercel, then run:

```bash
curl https://www.cipherballot.xyz/api/v1/health \
  -H "X-API-Key: $AGENT_API_KEY"
```

The response must confirm the expected chain, contract, relayer address, Redis, and QStash queue. Also verify the CSP, HSTS, frame denial, content-type, referrer, and permissions headers.

## 8. Mainnet Smoke Test

Use a non-binding proposal and small capped balances:

1. Create a two-option secret-sealed proposal with three committee wallets and a 2-of-3 threshold.
2. Download the recovery kit and confirm its offline backup.
3. Confirm committee readiness from two independent wallets.
4. Submit one direct encrypted ballot.
5. Submit one delegated-agent encrypted ballot.
6. Confirm an exact relay retry returns the same job rather than another transaction.
7. Confirm duplicate voting is rejected.
8. Wait for the on-chain deadline.
9. Release the encrypted committee handoff.
10. Reconstruct the tally independently from two committee wallets.
11. Approve matching evidence and confirm finalization.
12. Verify result, transcript, and explorer links.

## 9. Operations And Rollback

- Keep the relayer balance capped and alert before refill.
- Monitor health, RPC errors, Redis, QStash lag, failed jobs, and transaction reverts.
- Pause or disable QStash delivery during an incident.
- Rotate `AGENT_API_KEY` and signer allowlists if relay access is suspected.
- Revoke Redis/QStash tokens and replace the relayer key after confirmed exposure.
- Do not release an election recovery kit early. If confidentiality is suspected lost, invalidate the non-binding pilot result and rerun with a new proposal/key.
- Frontend/API regressions can be rolled back in Vercel. Contract defects require a new deployment and migration; the current contract is not upgradeable.

## 10. Release Record

For each deployment, publish a short record containing network, chain ID, contract, deployment transaction/block, verified-source link, Git commit, frontend deployment, relayer address, test report, committee policy, and known limitations.
