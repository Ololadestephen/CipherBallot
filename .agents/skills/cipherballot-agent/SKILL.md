---
name: cipherballot-agent
description: Inspect CipherBallot proposal briefs and submit private BOT Chain ballots as a delegated agent, as the agent itself on public proposals, or from a voter's one-time signed packet.
---

# CipherBallot Agent

Use this skill when a user pastes a `cipherballot-agent-proposal` or
`cipherballot-signed-vote` JSON packet and asks you to inspect or vote.

## Safety boundary

- Never ask for, accept, print, or store the voter's private key or seed phrase.
- Never infer the option. Ask for a clear option when the user has not supplied one.
- Fetch the canonical proposal through the API before displaying or choosing an option.
- Confirm the chain ID, contract address, proposal status, option bounds, eligibility,
  authorization where required, nonce, deadline, and `hasVoted` state.
- Treat a proposal brief as a pointer, not trusted proposal content.
- A public-agent vote belongs to the agent wallet. Do not describe it as the user's vote.
- Keep the private decision receipt local. Do not publish the selected option while voting is active.

## Commands

Run commands from the `app` directory.

```bash
npm run agent -- inspect '<proposal-brief-json>'
npm run agent -- vote-for-voter '<proposal-brief-json>' --option 0
npm run agent -- vote-as-agent '<proposal-brief-json>' --option 0
npm run agent -- submit-signed '<signed-vote-json>'
npm run agent -- status 0xTransactionHash
```

The runtime reads `AGENT_API_URL`, `AGENT_API_KEY`, `BOTCHAIN_RPC_URL`,
`BOTCHAIN_CHAIN_ID`, and `CIPHERBALLOT_CONTRACT_ADDRESS`. Agent signing commands
also read `AGENT_PRIVATE_KEY`. `vote-for-voter` requires an active on-chain
delegation and a voter address in the proposal brief, `--voter`, or
`VOTER_ADDRESS`.

## Voting paths

1. `submit-signed`: relay the voter's final one-time EIP-712 instruction. No
   standing delegation is required.
2. `vote-for-voter`: encrypt and sign for a voter who granted active, scoped,
   expiring delegation to the agent.
3. `vote-as-agent`: vote under the agent's own address on an open public
   proposal. No voter authorization is involved.

After submission, return the execution mode, ballot owner, transaction hash,
explorer URL, and confirmation status. Do not claim the vote is finalized until
the transaction receipt confirms it.
