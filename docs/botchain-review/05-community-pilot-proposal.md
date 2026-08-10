# BOT Chain Community Governance Pilot Proposal

## Pilot Name

BOT Chain Builder Priorities Vote

## Objective

Run one real, non-binding community decision through CipherBallot to validate private participation, agent-assisted voting, committee operations, public evidence, mobile usability, and operational readiness before a broader mainnet release.

The pilot is intentionally small. Its purpose is to validate an end-to-end governance process with actual BOT Chain builders, not to govern treasury funds or create legal obligations.

## Proposed Decision

**Question:** Which builder-support initiative should BOT Chain prioritize for the next community session?

Suggested options:

1. Mainnet deployment clinic
2. Smart-contract security office hours
3. Agent infrastructure workshop
4. Ecosystem growth and go-to-market session
5. Abstain

BOT Chain may replace the wording and options with another real, low-risk community decision.

## Recommended Configuration

| Setting | Recommendation |
| --- | --- |
| Environment | Testnet dry run, followed by mainnet pilot after readiness approval |
| Participants | 20-50 invited BOT Chain builders/community members |
| Eligibility | Fixed wallet allowlist for the primary pilot |
| Voting duration | 48 hours |
| Privacy mode | Secret-sealed encrypted ballots |
| Committee | Three independent wallets |
| Threshold | 2-of-3 matching tally approvals |
| Creator/custodian | CipherBallot operator, named before creation |
| Agent modes | Direct, one-time voter-signed, and delegated agent voting |
| Public-agent demonstration | Optional separate public sandbox proposal because allowlisted proposals intentionally reject public-agent self-votes |
| Result status | Advisory and non-binding |

## Pilot Security Basis

CipherBallot's current controls are suitable for this limited pilot scope. The participant allowlist prevents uninvited wallets from voting, the contract enforces one ballot per eligible owner, ballots remain encrypted on-chain during voting, and three named committee wallets require two matching approvals to finalize the result. The creator keeps the recovery kit offline and imports it only after the deadline to prepare encrypted, wallet-bound committee handoffs.

The pilot is designed to validate a real governance process while keeping the decision advisory. Distributed threshold decryption and public tally-verification proofs remain part of CipherBallot's broader cryptography roadmap.

## Roles

### CipherBallot

- deploy and verify the approved contract;
- configure and fund the capped relayer;
- create the proposal from approved wording;
- generate and protect the election recovery kit;
- provide the participant guide and support channel;
- monitor API, queue, RPC, relayer, and contract activity;
- coordinate the encrypted post-deadline handoff and avoid publishing individual ballot choices;
- produce the final evidence and pilot report.

### BOT Chain

- approve the use case, question, options, and participant group;
- nominate a pilot owner and communications contact;
- nominate at least two independent committee members, with the third agreed jointly;
- confirm mainnet network and explorer requirements if the second run uses mainnet;
- share the invitation with eligible participants;
- review the dry-run and final evidence;
- provide an RPC/explorer escalation contact during the voting window.

### Committee Members

- connect only the assigned committee wallet;
- confirm readiness before voting starts;
- return after the deadline;
- authenticate, unlock, and reconstruct the encrypted handoff locally;
- compare ballot count, option totals, transcript, and hash;
- approve only matching evidence they independently accept;
- report any discrepancy instead of signing.

## Participant Journey

1. Participant receives the proposal link and short privacy/agent explanation.
2. Participant connects a BOT Chain wallet and confirms eligibility.
3. Participant votes directly, signs a one-time relay packet, or uses a previously scoped agent delegation.
4. The DApp displays ballot-submission confirmation without exposing a live option tally.
5. After the deadline, committee members reconstruct and approve the result.
6. Participant can inspect the final tally, transcript reference, approval threshold, contract, and transactions.

## Timeline

| Day | Activity |
| --- | --- |
| Day 1 | Confirm the proposal question, participant group, three committee wallets, target network, and communications plan |
| Day 2 | Deploy or confirm the verified contract, complete a short operator dry run, and share the participant guide |
| Day 3 | Create the proposal and open the 48-hour voting window |
| Day 4 | Keep voting open, monitor participation, and support voters and agents |
| Day 5 | Close voting, complete encrypted committee handoff and threshold finalization, then publish the result and pilot evidence |

## Success Criteria

- at least 20 eligible wallets are invited;
- at least 50% of invited wallets submit a valid ballot;
- zero unauthorized or duplicate ballots are accepted;
- no readable option totals are exposed before the deadline;
- at least one delegated or one-time voter-signed agent ballot is confirmed;
- Redis/QStash retries do not produce duplicate transactions;
- two independent committee wallets reconstruct the same transcript;
- the result finalizes within 24 hours of voting close;
- contract, ballot, approval, and result evidence is publicly inspectable;
- no high-severity operational or security incident occurs;
- at least 80% of surveyed participants report that the voting flow was understandable.

## Evidence Deliverables

- verified contract and deployment transaction;
- proposal ID and friendly proposal code;
- participant count and submitted ballot count;
- transaction examples for each voting mode used;
- committee readiness and threshold policy;
- final tally, transcript URI, transcript hash, and approval transactions;
- anonymized usability feedback;
- incident log, including a statement when no incidents occurred;
- recommendations for broader mainnet adoption and product improvements.

## Operational Continuity

CipherBallot will monitor the contract, RPC, relayer, queue, and committee workflow throughout the voting window. If an infrastructure or configuration issue interrupts participation, the teams can pause communications, resolve the issue, and resume or recreate the advisory proposal with a clear participant update.

Contract addresses, proposal details, committee approvals, and final result evidence remain publicly inspectable, giving both teams a clear record for troubleshooting and the final pilot report.

## Support Requested From BOT Chain

1. Approve the pilot use case and testnet-to-mainnet progression.
2. Nominate a pilot owner, communications contact, and two committee members.
3. Confirm mainnet RPC, chain ID, explorer verification, and funding requirements.
4. Invite a controlled group of BOT Chain builders or community members.
5. Provide an RPC/explorer contact during the voting window.
6. Consider ecosystem or grant support for mainnet deployment, relayer operations, product development, and the threshold-cryptography roadmap.
7. Review the final evidence and identify opportunities for wider community governance use and BOT Chain ecosystem integration.

## Decision Requested

CipherBallot requests confirmation of a pilot sponsor, proposal wording, participant group, three committee wallets, target network, and target week. Setup can begin as soon as these details are agreed, alongside discussion of the appropriate BOT Chain ecosystem-support or grant path.
