# Security-Hardening Summary

Assessment date: 2026-08-10

Scope: Solidity contract, browser cryptography, agent client, relay API and worker, Redis/QStash coordination, committee handoff, deployment configuration, and browser security headers.

This engineering summary documents the controls that support a controlled BOT Chain community pilot and the operational model for running it successfully.

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

## Pilot Security Posture

The implemented controls are suitable for the proposed BOT Chain community governance pilot. The pilot uses a fixed participant allowlist, three named committee wallets, a 2-of-3 approval threshold, a capped relayer balance, an operator rehearsal, and public transaction evidence. Together, these controls support the complete governance workflow with real participants.

### Current Trust Model

1. **Election-key custody.** The proposal recovery kit is held offline by the named creator/custodian until voting closes. CipherBallot validates the on-chain deadline before enabling kit import and committee handoff. Because the current release uses one election private key rather than distributed key shares, secure custody remains an operational responsibility for the pilot.
2. **Committee-attested tally.** Committee members independently reconstruct the transcript and approve one matching tally hash after voting closes. The contract requires threshold agreement and prevents tally inflation. Public proof verification of correct decryption and completeness is part of the production roadmap.
3. **Participant eligibility.** The primary pilot uses a fixed wallet allowlist. Optional public proposals remain one-address-one-ballot and are intended for open community signaling rather than identity-based voting.
4. **Browser and service operations.** Commit-reveal secrets and private agent receipts remain under the participant's browser account, while Vercel, the BOT Chain RPC, Redis, and QStash provide application availability. The pilot runbook includes health checks, monitoring, backups, and direct contract evidence.

### Cryptography Roadmap

The next cryptography milestones extend the current committee workflow:

1. distributed key generation and threshold decryption shares; and
2. publicly verifiable proof that valid ballot envelopes were correctly decrypted and tallied.

These enhancements build on the pilot-ready system described in this package.

## Pilot Security Constraints

For the proposed BOT Chain pilot, CipherBallot will:

- run the agreed advisory community decision;
- use a fixed participant allowlist when identity/Sybil resistance matters;
- use three independent committee wallets with a 2-of-3 threshold;
- keep the recovery kit offline with a named custodian and backup;
- cap the relayer balance and restrict accepted signers if the participant set is known;
- publish contract, proposal, and result evidence before and after the vote;
- document the current committee-attested tally model in the participant and operator runbooks.

## Incident Response

1. Pause QStash or disable the worker when relay behavior is abnormal.
2. Preserve job IDs, timestamps, transaction hashes, and provider logs without publishing secrets.
3. Rotate the API key, Redis/QStash credentials, and relayer key according to exposure scope.
4. Revoke active agent delegation when an agent key may be compromised.
5. Do not release the recovery kit while an incident is unresolved.
6. Publish a participant notice and repeat a non-binding election with a new proposal/key if confidentiality or tally integrity is uncertain.
7. Report code vulnerabilities privately through GitHub Security Advisories.

## Production Hardening Roadmap

1. Distributed key generation and threshold decryption shares.
2. Publicly verifiable proof that all valid envelopes were correctly decrypted and tallied.
3. Hardware-backed or MPC custody for operator and committee secrets.
4. Post-mainnet snapshot-based ERC-20, ERC-721, and ERC-1155 eligibility with configurable minimum holdings, plus credential and membership modules.
5. Redundant RPC providers, event indexing, monitoring, and incident dashboards.
6. Persistent policy-based agent runner with safe abstention and auditable decision receipts.
