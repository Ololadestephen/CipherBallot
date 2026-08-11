# Test Report

Execution date: 2026-08-10

Implementation baseline: commit `92258ef` (merged through [PR #8](https://github.com/Ololadestephen/CipherBallot/pull/8)).

## Environment

| Item | Value |
| --- | --- |
| Local platform | macOS |
| Node.js | `v25.7.0` |
| npm | `11.10.1` |
| Forge | `1.5.1-stable` |
| Solidity | `0.8.24` |
| CI Node.js | `22` |
| BOT Chain testnet | Chain ID `968` |

CI evidence: [Contract, app, and agent checks](https://github.com/Ololadestephen/CipherBallot/actions/runs/31373775641/job/93408351294), completed successfully in 36 seconds. Vercel deployment and preview checks also passed for the same implementation review.

## Summary

| Command | Result | Coverage focus |
| --- | --- | --- |
| `forge test --offline` | 20 passed, 0 failed, 0 skipped | Contract lifecycle, bounds, eligibility, privacy modes, delegation, nonces, signatures, tally approvals |
| `npm run test:crypto` | Passed | Node/browser envelope interoperability, authenticated context, tamper rejection |
| `npm run test:agent-client` | Passed | Brief and packet formats, proposal codes, mode separation, malformed input |
| `npm run test:relay-store` | Passed | Idempotency, distributed lock, rate limits, tally storage, committee storage, one-time challenges |
| `npm run test:tally-transcript` | Passed | Deterministic transcript hash, tally structure, malformed/mismatched transcript rejection |
| `npm run test:committee-handoff` | Passed | AES-GCM handoff, proposal binding, wrong-key rejection, friendly codes |
| `npm run test:e2e` | Passed | Full delegated, voter-signed, public-agent, retry, decryption, committee, and finalization lifecycle |
| `npm run build` | Passed | Public environment validation and production Vite bundle |
| `npm audit --omit=dev` | 0 vulnerabilities | Production dependency advisory scan |

## Contract Test Coverage

The 20 Foundry tests cover:

- commit-reveal creation, reveal, and finalization;
- duplicate commitment rejection;
- invalid reveal rejection;
- reveal-period enforcement;
- allowlist enforcement;
- secret-sealed finalization after matching committee approvals;
- mismatched tally rejection;
- invalid election public-key rejection;
- ciphertext proof-binding rejection;
- oversized encrypted-ballot rejection;
- tally-total cap enforcement;
- required tally evidence;
- ambiguous proposal configuration rejection;
- authorized delegated-agent submission;
- revoked-agent rejection;
- delegation-change nonce invalidation;
- one-time voter-signed relay without delegation;
- public-agent self-voting;
- public-agent rejection on allowlisted proposals;
- cross-mode signature rejection.

## Full Local E2E Result

The E2E suite starts an ephemeral Anvil chain, deploys a fresh contract, exercises the API handlers and relayer, advances time, decrypts ballots, and finalizes through committee approvals.

```json
{
  "result": "passed",
  "chainId": 968,
  "proposalId": "1",
  "delegatedAgentVoteRelayed": true,
  "voterSignedVoteRelayed": true,
  "publicAgentVoteRelayed": true,
  "replayDeduplicated": true,
  "decryptedOption": 0,
  "finalTally": [1, 1, 1],
  "finalized": true
}
```

The first sandboxed execution could not bind a localhost listener (`EPERM`). The same command was rerun with localhost access and passed. This was an execution-environment restriction, not an application assertion failure.

## BOT Chain Mainnet Deployment Evidence

| Item | Verified value |
| --- | --- |
| Network | BOT Chain mainnet, chain ID `677` |
| Contract | [`0x1559C3a6B02E331307438D7839016EA5A827F467`](https://scan.botchain.ai/address/0x1559C3a6B02E331307438D7839016EA5A827F467) |
| Deployment transaction | [`0xddcfcb...ca36`](https://scan.botchain.ai/tx/0xddcfcb980c2f700accccd2f7eb3482f7b63444c38cea48cc1ddbc7dad47cca36) |
| Deployment block | `19263053` |
| Release commit | `6653cad` |
| Compiler | Solidity `0.8.24`, optimizer `200`, `via_ir=true` |
| Contract tests | 20 passed, 0 failed, 0 skipped immediately before deployment |
| Runtime bytecode | `12045` bytes; exact match with the release artifact |
| Runtime bytecode hash | `0xdd02e913a2113e1f1ebe3fc360452b6947daac85d0f0543ad881a5bd7e55afab` |
| Initial state | `proposalCount = 0` |

The deployment receipt succeeded with `2,658,102` gas used. BOTScan accepted and verified the exact source after deployment.

## Live BOT Chain End-to-End Evidence

### Completed Governance Run

Proposal `2`, **Botchain Mainnet Deployment?**, completed the full secret-sealed lifecycle on the source-verified BOT Chain testnet contract.

| Item | Verified value |
| --- | --- |
| Friendly reference | `CB-JWCP-8EHX` |
| Contract | [`0x3C250cBf439431D7dd8525Ca9800c577a9533e3C`](https://scan.bohr.life/address/0x3C250cBf439431D7dd8525Ca9800c577a9533e3C) |
| Contract deployment | [`0x656445...dd67`](https://scan.bohr.life/tx/0x656445179fecda3b26bbb925a15f40ceb0bc24e2cc33fa57556be359d144dd67), block `19063989` |
| Proposal creation | [`0xd0f581...2b42`](https://scan.bohr.life/tx/0xd0f5816dc84f98018d43e5adbe29ae3c9566f211e526bfefb77ef2b3d95e2b42), block `19359633` |
| Voting window | 2026-08-10 09:42:44–12:42:44 UTC |
| Eligibility and privacy | Public eligibility; secret-sealed encrypted ballots |
| Participation | 6 distinct ballot owners and 6 recorded private ballots |
| Committee policy | 3 committee wallets; 2 matching approvals required |
| Final tally | **Yes: 5, No: 1** |
| Final state | Finalized with 2/2 approvals |
| Result view | [`/results?proposal=2`](https://www.cipherballot.xyz/results?proposal=2) |

### Transaction Trail

| Step | Transaction | On-chain evidence |
| --- | --- | --- |
| Public-agent encrypted ballot | [`0x7152d7...9363`](https://scan.bohr.life/tx/0x7152d76f282adeae4137a69394c771b8365d90e8c8942c6a5bd182e04f439363) | `PublicAgentBallotSubmitted`, block `19359851` |
| Delegated voter-attributed encrypted ballot | [`0x7f0a50...7062`](https://scan.bohr.life/tx/0x7f0a508c6406b04f29238fb9844c93975169bcbac307999c4604a6935f477062) | `AgentBallotSubmitted`, block `19359923` |
| Direct encrypted ballot | [`0xbddaa1...7464`](https://scan.bohr.life/tx/0xbddaa12d48291f7b913d858fa50ab8761b6e7c6a2f195cb2451308ff8b587464) | `PrivateBallotSubmitted`, block `19360255` |
| Direct encrypted ballot | [`0x80b959...5a18`](https://scan.bohr.life/tx/0x80b959b057dd071a31145d558540b0b8887caef9e3da5c56a61772fe9e205a18) | `PrivateBallotSubmitted`, block `19360492` |
| Direct encrypted ballot | [`0x220200...7da`](https://scan.bohr.life/tx/0x220200221e571ba14b4c8e60389b3f79ffc84e93e77635763f332097011ce7da) | `PrivateBallotSubmitted`, block `19360745` |
| Second public-agent encrypted ballot | [`0x23a2b2...815f`](https://scan.bohr.life/tx/0x23a2b24a0f3c2654ff73442202b632e03b4a7a2759c132db29c76129df61815f) | `PublicAgentBallotSubmitted`, block `19363892` |
| First committee approval | [`0x87a0c3...9459`](https://scan.bohr.life/tx/0x87a0c3c1917545e641623789d54df20ebdd9e72ac6d5662f37c2f619ddab9459) | Approval 1/2, block `19374625` |
| Second approval and finalization | [`0xb432d5...3ee6`](https://scan.bohr.life/tx/0xb432d5e2d490de673ba7db6fa80f293ca9a579875d33c2a7e58343549b343ee6) | Approval 2/2 and `ProposalFinalized`, block `19374759` |

### Tally And Transcript Verification

- The two committee approvals matched tally hash `0xad8ee675f5cdf8f0083618cef2fe9ce50a769e9dd008cf43daad02571a0d0906`.
- The published [tally transcript](https://www.cipherballot.xyz/api/v1/tallies?hash=0x67f5dc0eb33588a8f0160c257f1e8d97356e5243eec7cf4f94840eec81866253) contains all six ballot transaction hashes, six distinct voters, the two proposal options, and final tally `[5, 1]`.
- Hashing the exact published transcript JSON with `keccak256(toUtf8Bytes(transcript))` produced `0x67f5dc0eb33588a8f0160c257f1e8d97356e5243eec7cf4f94840eec81866253`, matching the on-chain `tallyProofHash`.
- Each ballot emitted a distinct `privateBallotHash` and deterministic `ballotProofHash`; the transaction calldata exposed ciphertext, not the selected option.
- Both approvals were submitted after the on-chain voting deadline. The second matching approval finalized the proposal approximately nine minutes after voting closed.
- The final tally sum equals the contract's recorded ballot count: `5 + 1 = 6`.

This live run verifies proposal creation, direct private voting, public-agent voting, delegated voter-attributed voting, relayer submission, post-deadline transcript publication, threshold committee approval, finalization, and public result display against the deployed BOT Chain contract.

## Static And Build Observations

- The public-environment check passed and found no known secret variable names in the browser build configuration.
- `git diff --check` passed for the implementation changes.
- Foundry emitted optimization-style lint notes for standard `keccak256` usage and one constant naming note. They do not represent test failures.
- Vite emitted a warning that the main JavaScript chunk exceeds 500 kB after minification. Code splitting is a performance follow-up; the build completed successfully.

## What This Report Does Not Prove

- It does not prove the cryptographic correctness of every possible browser/provider implementation.
- Election-key custody and committee independence are operational trust assumptions outside the scope of automated testing; the pilot runbook addresses them through named roles, offline custody, and threshold review.
- It does not include sustained load, denial-of-service, chaos, or mainnet-scale testing.
- It does not replace final iOS/Android wallet UAT or accessibility review.
- It does not verify a zero-knowledge proof of complete and correct tallying; none is implemented in V2.

## Reproduction

```bash
git clone https://github.com/Ololadestephen/CipherBallot.git
cd CipherBallot

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
