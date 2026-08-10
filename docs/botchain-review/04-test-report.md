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

## Live BOT Chain Evidence

| Action | Transaction | Explorer result |
| --- | --- | --- |
| Current contract deployment | [`0x656445...dd67`](https://scan.bohr.life/tx/0x656445179fecda3b26bbb925a15f40ceb0bc24e2cc33fa57556be359d144dd67) | Success, block `19063989`, verified created contract |
| Public agent encrypted ballot on proposal `2` | [`0x7152d7...9363`](https://scan.bohr.life/tx/0x7152d76f282adeae4137a69394c771b8365d90e8c8942c6a5bd182e04f439363) | `submitPublicAgentBallot`, success, block `19359851` |
| Delegated voter-attributed encrypted ballot on proposal `2` | [`0x7f0a50...7062`](https://scan.bohr.life/tx/0x7f0a508c6406b04f29238fb9844c93975169bcbac307999c4604a6935f477062) | `submitPrivateBallotByAgent`, success, block `19359923` |

The explorer reports the deployed destination contract as verified and decodes both agent-voting methods. Ciphertext is visible as expected; the selected option is not readable from the transaction input.

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
