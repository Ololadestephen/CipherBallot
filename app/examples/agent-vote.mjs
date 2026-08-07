import {
  agentWalletFromEnvironment,
  createAgentRuntime,
  createProposalBrief,
  voteWithAgent
} from "./lib/agent-client.mjs";

for (const name of ["AGENT_PRIVATE_KEY", "PROPOSAL_ID", "OPTION_INDEX"]) {
  if (!process.env[name]) throw new Error(`Missing ${name}.`);
}

const runtime = createAgentRuntime();
const mode = process.env.VOTE_MODE === "public-agent" ? "public-agent" : "delegated";
const brief = createProposalBrief({
  chainId: runtime.chainId,
  contractAddress: runtime.contractAddress,
  proposalId: process.env.PROPOSAL_ID,
  ...(process.env.VOTER_ADDRESS ? { voter: process.env.VOTER_ADDRESS } : {})
});
const result = await voteWithAgent(runtime, {
  mode,
  agentWallet: agentWalletFromEnvironment(runtime),
  brief,
  optionIndex: Number(process.env.OPTION_INDEX),
  voter: process.env.VOTER_ADDRESS,
  deadlineSeconds: Number(process.env.AGENT_VOTE_DEADLINE_SECONDS || 900)
});

console.log(JSON.stringify({
  status: result.status,
  mode: result.mode,
  ballotOwner: result.ballotOwner,
  txHash: result.txHash,
  explorerUrl: result.explorerUrl
}, null, 2));
