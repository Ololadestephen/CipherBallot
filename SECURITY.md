# Security Policy

CipherBallot is currently deployed on BOT Chain testnet and is suitable for controlled governance pilots. Distributed threshold decryption and public tally-verification proofs are the next major cryptography milestones.

## Reporting a Vulnerability

Please report vulnerabilities privately through the repository's GitHub Security Advisory interface. Do not include election private keys, tally secrets, relayer credentials, API keys, or wallet keys in an issue, screenshot, or public proof of concept.

Include the affected component, impact, reproduction steps, and the smallest safe proof of concept. Reports involving active elections should avoid decrypting or publishing ballot choices.

## Security Boundaries

The protocol enforces proposal timing, eligibility, one ballot per owner, mode-separated EIP-712 signatures, replay-protected nonces, delegation scope and expiry, deterministic ballot-envelope commitments, bounded calldata, tally evidence fields, and a final-tally total that cannot exceed recorded participation.

The current release uses committee-attested tally finalization. Multiple committee accounts must reconstruct the transcript and approve identical evidence, and the contract prevents tally inflation. The proposal recovery kit is held offline by the named creator/custodian, and CipherBallot enables kit import and encrypted committee handoff only after the on-chain deadline. The election key is not yet distributed threshold key material, and the contract does not yet verify a public proof of correct decryption and tally completeness; both are production-expansion milestones.

Public proposals are one-address-one-ballot, not one-person-one-ballot. Sybil resistance requires an allowlist or a future token, credential, or membership eligibility module.

## Secret Handling

- Generate election kits on a trusted offline or local machine.
- Never place election private keys, tally secrets, relayer keys, agent keys, or API keys in `VITE_` variables.
- Keep the election private key unavailable until the on-chain voting deadline has passed.
- Use a dedicated funded relayer wallet with a capped balance.
- Set `RELAYER_EXPECTED_ADDRESS` so a configuration error cannot silently activate the wrong key.
- Rotate `AGENT_API_KEY` after suspected exposure and restrict `AGENT_API_ALLOWED_ORIGIN`.
- Use `AGENT_API_ALLOWED_SIGNERS` when operating a closed pilot.

## Production Relayer

The API stores relay jobs, idempotency state, distributed locks, and rate-limit counters in Redis. QStash invokes a signature-verified FIFO worker with queue parallelism fixed at one. The worker rechecks on-chain authorization, nonce, ballot state, deadline, simulation, and gas before submission, then reconciles a stored transaction hash across retries.

Redis and QStash availability are operational dependencies. Production operators should monitor their dead-letter queue, failed jobs, relayer balance, RPC health, and spending. The API key protects relayer funds; voting authority still comes from a valid voter or agent signature.

## Deployment Status

Security-sensitive contract changes require a fresh deployment and source verification. Review the deployed bytecode address rather than assuming the repository's current source matches an older testnet address.
