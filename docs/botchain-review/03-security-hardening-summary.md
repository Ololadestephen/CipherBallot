# Security-Hardening Summary

Assessment date: 2026-08-10

Scope: Solidity contract, browser cryptography, agent client, relay API and worker, Redis/QStash coordination, committee handoff, deployment configuration, and browser security headers.

This is an engineering security summary, not an independent audit or formal cryptographic proof.

## Security Objectives

CipherBallot is designed to:

1. prevent one ballot owner from voting more than once per proposal;
2. keep readable choices out of public contract state during active secret-sealed voting;
3. separate voter, delegated-agent, voter-signed, and public-agent authority;
4. prevent signature replay and stale delegation use;
5. prevent a single committee wallet from finalizing a threshold result;
6. prevent relayer duplication and cross-instance nonce races;
7. keep server-side credentials and election secrets out of the public frontend bundle;
8. retain public evidence for deployment, participation, approvals, and final results.

## Implemented Controls

### Smart Contract

| Threat | Control |
| --- | --- |
| Duplicate voting | One stored commitment/hash per ballot owner and proposal; duplicate submissions revert. |
| Voting outside the window | Start/end timestamps and finalized state are checked on-chain. |
| Unauthorized allowlist participation | Fixed allowlist membership is enforced for direct and voter-attributed ballots. |
| Oversized or ambiguous input | Title, option, allowlist, committee, ballot, and tally evidence bounds are enforced. Duplicate options are rejected. |
| Invalid election key | A 65-byte uncompressed secp256k1 public key is checked for prefix, field range, and curve membership. |
| Unbound encrypted payload | `ballotProofHash` must match the deterministic contract commitment to the submitted ciphertext hash. |
| Signature replay | Delegated, voter-signed, and public-agent modes use separate EIP-712 types and nonce spaces. |
| Signature malleability | Signature recovery requires canonical low-`s` ECDSA and valid `v`. |
| Stale delegation | Expiry and proposal scope are checked. Updating or revoking an active delegation increments its nonce. |
| Cross-mode signature use | Mode-specific type hashes prevent a public-agent signature from being used as a voter signature. |
| False tally inflation | Sum of final tally values cannot exceed the contract's recorded ballot count. |
| Unilateral threshold finalization | At least two committee members and a threshold of at least two are required. Approvals must match one exact tally hash. |
| Early finalization | Secret-sealed tally approval is blocked until voting has ended. |

### Ballot Cryptography

- Each ballot uses a fresh ephemeral secp256k1 ECDH key agreement.
- The derived secret feeds AES-256-GCM authenticated encryption.
- Authenticated data binds the envelope to version, chain ID, contract, proposal, and ballot owner.
- The plaintext includes the same context and selected option, which is checked after decryption.
- Node and browser implementations are tested for interoperability.
- Tampered ciphertext, wrong context, wrong proposal, and wrong private key are rejected.

### Agent And Relayer

- Proposal briefs are pointers, not authority, and contain no selected option or private key.
- The agent client fetches canonical API and on-chain proposal state and rejects mismatches.
- Relay packets require decimal-string nonces/deadlines, fixed signature lengths, known fields, and valid ciphertext/proof structure.
- The API key is checked using constant-time comparison and must be at least 32 characters.
- Optional `AGENT_API_ALLOWED_SIGNERS` restricts closed pilots to approved voter/agent signers.
- Per-client and per-signer Redis rate limits reduce abuse.
- Deterministic job IDs make exact retries idempotent.
- Redis distributed locks prevent concurrent execution of one job across serverless instances.
- The worker rechecks nonce, authority, deadline, ballot state, gas, and simulation immediately before submission.
- QStash signs worker requests, uses retries, and is configured with FIFO parallelism `1`.
- Stored transaction hashes are reconciled before retrying, reducing duplicate gas spend after ambiguous responses.
- `RELAYER_EXPECTED_ADDRESS` detects relayer-key configuration mistakes.

### Committee Handoff

- The creator imports the recovery-kit JSON locally only after the on-chain deadline.
- The browser validates the kit against the proposal before release.
- AES-256-GCM encrypts the handoff package; Redis receives ciphertext, IV, context, and key commitment, not plaintext election material.
- The handoff key remains in the URL fragment and is removed from the visible address after loading.
- Readiness, release, retrieval, and revocation use short-lived one-time wallet challenges.
- Challenges are atomically consumed and signer roles are checked again against the contract.
- Only the creator may release or revoke; only listed committee wallets may retrieve.
- The portal UI and entry points hide committee details until the connected wallet is identified on-chain as creator or committee.
- Portal status metadata is not treated as secret; the recovery package remains protected by signed retrieval authorization and client-side encryption.

### Browser And Deployment

- Public-environment validation rejects known secret variable names using the `VITE_` prefix.
- CSP restricts scripts and connections, disables objects, blocks framing, and limits forms to the same origin.
- HSTS, `nosniff`, referrer, permissions, and frame-denial headers are configured.
- API responses use `no-store` and repeat key security headers.
- Sensitive environment files, recovery kits, build output, Foundry artifacts, and Vercel metadata are gitignored.
- Protected `main` requires signed commits and the `Contract, app, and agent checks` status check.

## Residual Risks

### High Priority

1. **Single election-key custody.** One recovery-kit private key can decrypt ballots before the deadline if its custodian discloses or uses it early. The contract cannot detect early off-chain decryption.
2. **Tally correctness is committee-attested.** A colluding threshold can approve an incorrect or incomplete tally. The contract enforces matching evidence and prevents inflation, but does not verify decryption or completeness.
3. **No independent audit.** Automated tests and internal review reduce risk but are not a substitute for an external contract, cryptography, and relayer assessment.

### Medium Priority

1. **Public-vote Sybil resistance.** Public proposals are one-address-one-ballot, not one-person-one-ballot. Use allowlists for a controlled pilot.
2. **Browser-origin compromise.** Commit-reveal secrets and private agent receipts are stored in `localStorage`. Malicious same-origin code could read them. Recovery-kit material is kept in memory/downloads instead of `localStorage`.
3. **Centralized availability dependencies.** The DApp depends on the configured BOT Chain RPC, Vercel, Redis, and QStash. Their outage can delay relay or committee operations, though direct contract access remains possible.
4. **Relayer operational risk.** A leaked API key can consume relay capacity and potentially spend capped relayer funds, but cannot forge voter/agent signatures or bypass contract rules.
5. **No contract upgrade path.** A defect requires a new deployment and explicit migration rather than an in-place upgrade.

### Lower Priority And Operational

- Portal visibility is a frontend privacy control; signed backend authorization protects privileged actions and ciphertext retrieval.
- Friendly proposal codes are deterministic references, not secret identifiers or replacements for canonical on-chain IDs.
- Large frontend bundle size is a performance concern, not a correctness control failure.
- Committee independence and review quality are governance assumptions that code alone cannot enforce.

## Pilot Security Constraints

For the proposed BOT Chain pilot:

- keep the decision non-binding and non-financial;
- use a fixed participant allowlist when identity/Sybil resistance matters;
- use three independent committee wallets with a 2-of-3 threshold;
- keep the recovery kit offline with a named custodian and backup;
- cap the relayer balance and restrict accepted signers if the participant set is known;
- publish contract, proposal, and result evidence before and after the vote;
- cancel and repeat the pilot if election-key confidentiality is suspected;
- do not interpret the pilot as evidence that threshold decryption or ZK tally verification is implemented.

## Incident Response

1. Pause QStash or disable the worker when relay behavior is abnormal.
2. Preserve job IDs, timestamps, transaction hashes, and provider logs without publishing secrets.
3. Rotate the API key, Redis/QStash credentials, and relayer key according to exposure scope.
4. Revoke active agent delegation when an agent key may be compromised.
5. Do not release the recovery kit while an incident is unresolved.
6. Publish a participant notice and repeat a non-binding election with a new proposal/key if confidentiality or tally integrity is uncertain.
7. Report code vulnerabilities privately through GitHub Security Advisories.

## Production Hardening Roadmap

1. Independent contract, browser-cryptography, and relayer audit.
2. Distributed key generation and threshold decryption shares.
3. Publicly verifiable proof that all valid envelopes were correctly decrypted and tallied.
4. Hardware-backed or MPC custody for operator and committee secrets.
5. Token, credential, or attestation-based eligibility modules.
6. Redundant RPC providers, event indexing, monitoring, and incident dashboards.
7. Persistent policy-based agent runner with safe abstention and auditable decision receipts.
