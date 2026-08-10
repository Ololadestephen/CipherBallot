# Mainnet Readiness Checklist

Assessment date: 2026-08-10

Status legend:

- **Verified**: implemented and supported by repository or live evidence.
- **Ready**: implementation exists; an operator must complete the listed deployment action.
- **Pending**: requires BOT Chain coordination or production operations.
- **Roadmap**: deliberately outside the current release.

## 1. Product And User Experience

| Check | Status | Evidence or required action |
| --- | --- | --- |
| Working public DApp | Verified | `https://www.cipherballot.xyz` returns HTTP 200. |
| Proposal creation | Verified | Creator workflow supports timing, options, privacy mode, allowlist, committee, and threshold configuration. |
| Private one-action voting | Verified | Browser and agent clients encrypt choices locally before on-chain submission. |
| Direct and agent voting | Verified | Direct, voter-signed, delegated-agent, and public-agent contract paths are implemented. |
| Committee operations | Verified | Readiness, encrypted post-deadline handoff, tally reconstruction, approvals, and revocation are available. |
| Result and proof views | Verified | Final tally, transcript reference, proof hash, contract, and explorer evidence are exposed. |
| Mobile-responsive layout | Ready | Responsive layouts are implemented; final BOT Chain device-matrix UAT remains part of the pilot dry run. |
| User-facing errors | Verified | Known contract and relay errors are translated into actionable messages. |
| Accessibility review | Pending | Complete keyboard, screen-reader, and contrast audit before broad public launch. |

## 2. Contract And Chain Integration

| Check | Status | Evidence or required action |
| --- | --- | --- |
| Testnet deployment | Verified | Contract `0x3C25...3e3C`, deployment block `19063989`. |
| Explorer source verification | Verified | BOTScan reports verified Solidity source, compiler `0.8.24`, optimizer enabled. |
| Proposal timing | Verified | Start, end, reveal, and finalization rules are enforced on-chain. |
| One ballot per owner | Verified | Duplicate direct, delegated, voter-signed, and public-agent ballots are rejected. |
| Eligibility policy | Verified | Public and fixed allowlist proposals are supported. |
| Agent authorization | Verified | Delegation scope, expiry, revocation, signatures, and separate nonces are enforced. |
| Committee threshold | Verified | At least two committee members and at least two matching approvals are required by the current contract. |
| Mainnet contract | Pending | Deploy fresh immutable bytecode to BOT Chain mainnet and verify source before pilot use. |
| Mainnet chain parameters | Pending | BOT Chain must confirm the production RPC, chain ID, explorer, and native-token funding process. |

## 3. Relayer And API

| Check | Status | Evidence or required action |
| --- | --- | --- |
| Dedicated relayer wallet | Ready | A dedicated funded relayer is used; rotate and fund a mainnet-specific wallet. |
| Relayer identity pinning | Verified | `RELAYER_EXPECTED_ADDRESS` prevents silent key substitution. |
| API authentication | Verified | A constant-time checked API key protects proposal, health, vote, and status resources. |
| Origin restrictions | Verified | Same-origin and explicit allowlist checks are implemented. |
| Request validation | Verified | Unknown fields, malformed signatures, oversized bodies/envelopes, stale nonces, and invalid deadlines are rejected. |
| Contract simulation | Verified | Relay requests are simulated before queueing/broadcast. |
| Durable job state | Verified | Redis persists jobs, idempotency records, rate limits, committee records, and distributed locks. |
| Serialized execution | Verified | QStash queue parallelism is fixed at one and worker requests require a valid QStash signature. |
| Production monitoring | Pending | Configure alerts for queue lag, failed jobs, RPC errors, relayer balance, and abnormal spend. |
| Credential rotation drill | Pending | Rotate API, Redis, QStash, and relayer credentials in a staging dry run. |

## 4. Privacy And Committee Operations

| Check | Status | Evidence or required action |
| --- | --- | --- |
| Local ballot encryption | Verified | Ephemeral secp256k1 ECDH and AES-256-GCM with proposal-bound authenticated data. |
| No readable live tally | Verified | The contract stores ciphertext commitments and participation totals, not readable options. |
| Election recovery kit | Verified | Generated locally and downloaded without placing private key material in frontend or server environment variables. |
| Encrypted committee handoff | Verified | Creator imports once after the deadline; only AES-GCM ciphertext is stored in Redis. |
| Committee authentication | Verified | One-time, expiring wallet challenges are consumed once and roles are rechecked on-chain. |
| Portal visibility | Verified | Portal UI and entry points are shown only to the on-chain creator or committee wallets. Privileged API actions remain signature-protected. |
| Operational key ceremony | Pending | Name the kit custodian, backup location, release authority, and incident process before the pilot. |
| Distributed threshold decryption | Roadmap | Current V2 has one election private key; DKG and threshold key shares are not implemented. |
| Public proof of tally correctness | Roadmap | Transcript integrity is recorded, but correct decryption is not yet proven on-chain. |

## 5. Security And Quality Gates

| Check | Status | Evidence or required action |
| --- | --- | --- |
| Solidity tests | Verified | 20 passed, 0 failed, 0 skipped on 2026-08-10. |
| Crypto interoperability tests | Verified | Node/browser encryption, decryption, proof, tamper, and context-binding checks pass. |
| Agent and packet tests | Verified | Proposal briefs, signed packets, mode separation, and malformed input checks pass. |
| Relayer-store tests | Verified | Idempotency, locks, throttling, transcripts, challenges, and committee storage pass. |
| Full local E2E | Verified | Delegated, voter-signed, and public-agent ballots relay and finalize successfully. |
| Production build | Verified | Vite production bundle succeeds with public-environment validation. |
| Dependency audit | Verified | `npm audit --omit=dev` reports zero vulnerabilities. |
| CI protection | Verified | GitHub Actions check `Contract, app, and agent checks` is required on protected `main`. |

## 6. Pilot Launch Checklist

The pilot can launch when the teams complete these coordination steps:

- [ ] BOT Chain confirms whether the pilot runs first on testnet or mainnet.
- [ ] BOT Chain approves one real, non-financial proposal and its options.
- [ ] The eligible participant list and communication channel are agreed.
- [ ] Three independent committee wallets are named for a 2-of-3 threshold.
- [ ] The creator/custodian completes the recovery-kit runbook and offline backup.
- [ ] The relayer has a capped balance and alert threshold.
- [ ] A full dry run is completed with the same operator and committee roles.
- [ ] Contract address and source verification are checked by two people.
- [ ] Mobile smoke testing is completed on at least one iOS and one Android browser.

## Readiness Decision

**Recommended:** approve CipherBallot for a BOT Chain community governance pilot after the launch checks above. The application, contract, relayer, committee workflow, and automated validation are ready for this use case. A fresh verified mainnet deployment can follow the operator dry run, while distributed threshold decryption and publicly verifiable tally proofs continue as product-roadmap enhancements.
