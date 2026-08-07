import assert from "node:assert/strict";
import {
  createProposalBrief,
  createAgentRuntime,
  createSignedVotePacket,
  parseProposalBrief,
  parseSignedVotePacket
} from "./lib/agent-client.mjs";
import { encryptedBallotProofHash } from "./lib/ballot-envelope.mjs";

const contract = "0x72fAAA6C70FD94567c8D75cb0800033FCE10dE3a";
const voter = "0x8ac03Ec9430914B02df234c486eAFC79b072DAFa";
const agent = "0x07cff11194d054a17E7E9EbEe87a744830404D17";
const brief = createProposalBrief({ chainId: 968, contractAddress: contract, proposalId: 12, voter });
assert.deepEqual(parseProposalBrief(JSON.stringify(brief)), brief);
assert.deepEqual(parseProposalBrief(`\`\`\`json\n${JSON.stringify(brief)}\n\`\`\``), brief);
assert.throws(() => parseProposalBrief(JSON.stringify({ ...brief, option: 0 })), /Unknown proposal brief field/);

const shared = {
  proposalId: "12",
  encryptedBallot: "0x12",
  ballotProofHash: encryptedBallotProofHash("0x12"),
  nonce: "0",
  deadline: "1785859200",
  signature: `0x${"22".repeat(65)}`
};
const delegated = createSignedVotePacket({ mode: "delegated", voter, agent, ...shared });
assert.deepEqual(parseSignedVotePacket(JSON.stringify(delegated)), delegated);
const oneTime = createSignedVotePacket({ mode: "voter-signed", voter, ...shared });
assert.equal(oneTime.relayRequest.agent, undefined);
const publicAgent = createSignedVotePacket({ mode: "public-agent", agent, ...shared });
assert.equal(publicAgent.relayRequest.voter, undefined);
assert.throws(
  () => createSignedVotePacket({ mode: "public-agent", agent, voter, ...shared }),
  /Unknown signed vote field|voter/
);
assert.throws(() => createSignedVotePacket({ mode: "delegated", voter, agent, ...shared, nonce: 0 }), /nonce/);
assert.throws(
  () => createSignedVotePacket({ mode: "delegated", voter, agent, ...shared, ballotProofHash: `0x${"11".repeat(32)}` }),
  /does not bind/
);
assert.throws(
  () => parseProposalBrief(`{"type":"${brief.type}","version":1,"chainId":"968","contract":"${contract}","proposalId":"1","padding":"${"x".repeat(17_000)}"}`),
  /16 KB/
);
assert.throws(
  () => createAgentRuntime({ chainId: 968, contractAddress: contract, apiUrl: "http://relay.example", apiKey: "x".repeat(32) }),
  /HTTPS/
);
assert.throws(
  () => createAgentRuntime({ chainId: 968, contractAddress: contract, apiUrl: "https://relay.example", apiKey: "short" }),
  /32 characters/
);

console.log(JSON.stringify({ result: "passed", packetFormats: [brief.type, delegated.type] }, null, 2));
