import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Contract,
  ContractFactory,
  HDNodeWallet,
  JsonRpcProvider,
  Mnemonic,
  NonceManager,
  keccak256,
  randomBytes,
  toUtf8Bytes
} from "ethers";
import { decryptBallot, encryptBallot, generateElectionKeyPair } from "./lib/ballot-envelope.mjs";

const chainId = 968;
const contractArtifactPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../out/CipherBallotCommitReveal.sol/CipherBallotCommitReveal.json"
);

function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}

async function waitForRpc(provider) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await provider.getBlockNumber();
      return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
  }
  throw new Error("Local Anvil RPC did not start.");
}

function deriveWallet(mnemonic, index, provider) {
  return HDNodeWallet.fromPhrase(mnemonic, undefined, `m/44'/60'/0'/0/${index}`).connect(provider);
}

function invokeHandler(handler, { method, query = {}, body, headers = {} }) {
  return new Promise((resolveResponse, reject) => {
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolveResponse({ status: this.statusCode, body: payload, headers: this.headers });
      },
      end() {
        resolveResponse({ status: this.statusCode, body: null, headers: this.headers });
      }
    };

    Promise.resolve(handler({ method, query, body, headers }, response)).catch(reject);
  });
}

const port = await reservePort();
const rpcUrl = `http://127.0.0.1:${port}`;
const mnemonic = Mnemonic.fromEntropy(randomBytes(16)).phrase;
const anvil = spawn("anvil", ["--silent", "--host", "127.0.0.1", "--port", String(port), "--chain-id", String(chainId), "--mnemonic", mnemonic], {
  stdio: "ignore"
});

try {
  const provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
  await waitForRpc(provider);

  const deployerWallet = deriveWallet(mnemonic, 0, provider);
  const deployer = new NonceManager(deployerWallet);
  const voter = deriveWallet(mnemonic, 1, provider);
  const agent = deriveWallet(mnemonic, 2, provider);
  const relayer = deriveWallet(mnemonic, 3, provider);
  const committeeTwo = deriveWallet(mnemonic, 4, provider);
  const oneTimeVoter = deriveWallet(mnemonic, 5, provider);
  const publicAgent = deriveWallet(mnemonic, 6, provider);
  const artifact = JSON.parse(await readFile(contractArtifactPath, "utf8"));
  const factory = new ContractFactory(artifact.abi, artifact.bytecode.object, deployer);
  const deployed = await factory.deploy();
  await deployed.waitForDeployment();
  const contractAddress = await deployed.getAddress();
  const electionKey = generateElectionKeyPair();
  const latestBlock = await provider.getBlock("latest");
  const startTime = latestBlock.timestamp;
  const endTime = startTime + 60;
  const tallySecret = "local-e2e-tally-secret";

  const createTx = await deployed.createThresholdProposal(
    "Fund the public-goods pilot?",
    ["Approve", "Reject", "Abstain"],
    startTime,
    endTime,
    [],
    [deployerWallet.address, committeeTwo.address],
    2,
    electionKey.publicKey,
    keccak256(toUtf8Bytes(tallySecret))
  );
  await createTx.wait();
  const proposalId = 1n;

  const voterContract = deployed.connect(voter);
  const delegationTx = await voterContract.setAgentDelegation(agent.address, endTime + 300, proposalId);
  await delegationTx.wait();

  process.env.BOTCHAIN_RPC_URL = rpcUrl;
  process.env.BOTCHAIN_CHAIN_ID = String(chainId);
  process.env.CIPHERBALLOT_CONTRACT_ADDRESS = contractAddress;
  process.env.RELAYER_PRIVATE_KEY = relayer.privateKey;
  process.env.AGENT_API_KEY = "local-e2e-agent-api-key-32-bytes";
  process.env.AGENT_API_ALLOWED_ORIGIN = "http://localhost:5173";
  process.env.AGENT_RELAY_STORE = "memory";
  process.env.AGENT_RELAY_EXECUTION = "inline";

  const [{ default: proposalsHandler }, { default: votesHandler }] = await Promise.all([
    import("../api/v1/proposals.js"),
    import("../api/v1/votes.js")
  ]);
  const apiHeaders = { "x-api-key": process.env.AGENT_API_KEY };
  const configuredApiKey = process.env.AGENT_API_KEY;
  delete process.env.AGENT_API_KEY;
  const missingAuthenticationResponse = await invokeHandler(proposalsHandler, {
    method: "GET",
    query: { limit: "10" }
  });
  assert.equal(missingAuthenticationResponse.status, 503);
  process.env.AGENT_API_KEY = configuredApiKey;
  const unauthorizedResponse = await invokeHandler(proposalsHandler, {
    method: "GET",
    query: { limit: "10" }
  });
  assert.equal(unauthorizedResponse.status, 401);
  const disallowedOriginResponse = await invokeHandler(proposalsHandler, {
    method: "GET",
    query: { limit: "10" },
    headers: { ...apiHeaders, origin: "https://malicious.example" }
  });
  assert.equal(disallowedOriginResponse.status, 403);
  const proposalsResponse = await invokeHandler(proposalsHandler, {
    method: "GET",
    query: { limit: "10" },
    headers: apiHeaders
  });
  assert.equal(proposalsResponse.status, 200);
  assert.equal(proposalsResponse.body.proposals.length, 1);
  assert.equal(proposalsResponse.body.proposals[0].acceptsAgentVotes, true);
  assert.equal(proposalsResponse.body.proposals[0].acceptsVoterSignedVotes, true);
  assert.equal(proposalsResponse.body.proposals[0].acceptsPublicAgentVotes, true);
  assert.equal(proposalsResponse.body.proposals[0].encryptionPublicKey, electionKey.publicKey);
  const singleProposalResponse = await invokeHandler(proposalsHandler, {
    method: "GET",
    query: { proposalId: "1" },
    headers: apiHeaders
  });
  assert.equal(singleProposalResponse.status, 200);
  assert.equal(singleProposalResponse.body.proposal.id, 1);

  const encrypted = encryptBallot({
    optionIndex: 0,
    proposalId,
    voter: voter.address,
    encryptionPublicKey: electionKey.publicKey,
    chainId,
    contractAddress
  });
  const nonce = await deployed.agentNonces(voter.address, agent.address);
  const deadline = BigInt(startTime + 45);
  const domain = { name: "CipherBallot", version: "2", chainId, verifyingContract: contractAddress };
  const types = {
    AgentBallot: [
      { name: "voter", type: "address" },
      { name: "agent", type: "address" },
      { name: "proposalId", type: "uint256" },
      { name: "privateBallotHash", type: "bytes32" },
      { name: "ballotProofHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint64" }
    ]
  };
  const ballotIntent = {
    voter: voter.address,
    agent: agent.address,
    proposalId,
    privateBallotHash: encrypted.privateBallotHash,
    ballotProofHash: encrypted.ballotProofHash,
    nonce,
    deadline
  };
  const signature = await agent.signTypedData(domain, types, ballotIntent);
  const voteBody = {
    proposalId: proposalId.toString(),
    voter: voter.address,
    agent: agent.address,
    encryptedBallot: encrypted.privateBallot,
    ballotProofHash: encrypted.ballotProofHash,
    nonce: nonce.toString(),
    deadline: deadline.toString(),
    signature
  };
  const invalidNumericResponse = await invokeHandler(votesHandler, {
    method: "POST",
    body: { ...voteBody, proposalId: 1 },
    headers: { ...apiHeaders, "content-type": "application/json" }
  });
  assert.equal(invalidNumericResponse.status, 400);
  const unknownFieldResponse = await invokeHandler(votesHandler, {
    method: "POST",
    body: { ...voteBody, unexpected: true },
    headers: { ...apiHeaders, "content-type": "application/json" }
  });
  assert.equal(unknownFieldResponse.status, 400);
  const oversizedEnvelopeResponse = await invokeHandler(votesHandler, {
    method: "POST",
    body: { ...voteBody, encryptedBallot: `0x${"00".repeat(4097)}` },
    headers: { ...apiHeaders, "content-type": "application/json" }
  });
  assert.equal(oversizedEnvelopeResponse.status, 413);

  const voteResponse = await invokeHandler(votesHandler, {
    method: "POST",
    body: voteBody,
    headers: { ...apiHeaders, "content-type": "application/json" }
  });
  assert.equal(voteResponse.status, 202);
  assert.match(voteResponse.body.jobId, /^cb_[0-9a-f]{64}$/);
  assert.equal(voteResponse.body.status, "confirmed");
  const voteReceipt = await provider.waitForTransaction(voteResponse.body.txHash);
  assert.equal(voteReceipt.status, 1);
  assert.equal(await deployed.getPrivateBallotHash(proposalId, voter.address), encrypted.privateBallotHash);

  const replayResponse = await invokeHandler(votesHandler, {
    method: "POST",
    body: voteBody,
    headers: { ...apiHeaders, "content-type": "application/json" }
  });
  assert.equal(replayResponse.status, 202);
  assert.equal(replayResponse.body.jobId, voteResponse.body.jobId);
  assert.equal(replayResponse.body.txHash, voteResponse.body.txHash);

  const oneTimeEncrypted = encryptBallot({
    optionIndex: 1,
    proposalId,
    voter: oneTimeVoter.address,
    encryptionPublicKey: electionKey.publicKey,
    chainId,
    contractAddress
  });
  const oneTimeNonce = await deployed.voterBallotNonces(oneTimeVoter.address);
  const oneTimeTypes = {
    VoterBallot: [
      { name: "voter", type: "address" },
      { name: "proposalId", type: "uint256" },
      { name: "privateBallotHash", type: "bytes32" },
      { name: "ballotProofHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint64" }
    ]
  };
  const oneTimeSignature = await oneTimeVoter.signTypedData(domain, oneTimeTypes, {
    voter: oneTimeVoter.address,
    proposalId,
    privateBallotHash: oneTimeEncrypted.privateBallotHash,
    ballotProofHash: oneTimeEncrypted.ballotProofHash,
    nonce: oneTimeNonce,
    deadline
  });
  const oneTimeResponse = await invokeHandler(votesHandler, {
    method: "POST",
    body: {
      mode: "voter-signed",
      proposalId: proposalId.toString(),
      voter: oneTimeVoter.address,
      encryptedBallot: oneTimeEncrypted.privateBallot,
      ballotProofHash: oneTimeEncrypted.ballotProofHash,
      nonce: oneTimeNonce.toString(),
      deadline: deadline.toString(),
      signature: oneTimeSignature
    },
    headers: { ...apiHeaders, "content-type": "application/json" }
  });
  assert.equal(oneTimeResponse.status, 202);
  assert.equal(oneTimeResponse.body.mode, "voter-signed");
  const oneTimeReceipt = await provider.waitForTransaction(oneTimeResponse.body.txHash);
  assert.equal(oneTimeReceipt.status, 1);
  assert.equal(await deployed.getPrivateBallotHash(proposalId, oneTimeVoter.address), oneTimeEncrypted.privateBallotHash);

  const publicAgentEncrypted = encryptBallot({
    optionIndex: 2,
    proposalId,
    voter: publicAgent.address,
    encryptionPublicKey: electionKey.publicKey,
    chainId,
    contractAddress
  });
  const publicAgentNonce = await deployed.publicAgentNonces(publicAgent.address);
  const publicAgentTypes = {
    PublicAgentBallot: [
      { name: "agent", type: "address" },
      { name: "proposalId", type: "uint256" },
      { name: "privateBallotHash", type: "bytes32" },
      { name: "ballotProofHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint64" }
    ]
  };
  const publicAgentSignature = await publicAgent.signTypedData(domain, publicAgentTypes, {
    agent: publicAgent.address,
    proposalId,
    privateBallotHash: publicAgentEncrypted.privateBallotHash,
    ballotProofHash: publicAgentEncrypted.ballotProofHash,
    nonce: publicAgentNonce,
    deadline
  });
  const publicAgentResponse = await invokeHandler(votesHandler, {
    method: "POST",
    body: {
      mode: "public-agent",
      proposalId: proposalId.toString(),
      agent: publicAgent.address,
      encryptedBallot: publicAgentEncrypted.privateBallot,
      ballotProofHash: publicAgentEncrypted.ballotProofHash,
      nonce: publicAgentNonce.toString(),
      deadline: deadline.toString(),
      signature: publicAgentSignature
    },
    headers: { ...apiHeaders, "content-type": "application/json" }
  });
  assert.equal(publicAgentResponse.status, 202);
  assert.equal(publicAgentResponse.body.mode, "public-agent");
  assert.equal(publicAgentResponse.body.ballotOwner.toLowerCase(), publicAgent.address.toLowerCase());
  const publicAgentReceipt = await provider.waitForTransaction(publicAgentResponse.body.txHash);
  assert.equal(publicAgentReceipt.status, 1);
  assert.equal(await deployed.getPrivateBallotHash(proposalId, publicAgent.address), publicAgentEncrypted.privateBallotHash);

  await provider.send("evm_setNextBlockTimestamp", [endTime + 1]);
  await provider.send("evm_mine", []);
  const decrypted = decryptBallot({
    privateBallot: encrypted.privateBallot,
    electionPrivateKey: electionKey.privateKey,
    proposalId,
    chainId,
    contractAddress
  });
  assert.equal(decrypted.optionIndex, 0);
  assert.equal(decrypted.voter.toLowerCase(), voter.address.toLowerCase());
  const oneTimeDecrypted = decryptBallot({
    privateBallot: oneTimeEncrypted.privateBallot,
    electionPrivateKey: electionKey.privateKey,
    proposalId,
    chainId,
    contractAddress
  });
  const publicAgentDecrypted = decryptBallot({
    privateBallot: publicAgentEncrypted.privateBallot,
    electionPrivateKey: electionKey.privateKey,
    proposalId,
    chainId,
    contractAddress
  });
  assert.equal(oneTimeDecrypted.optionIndex, 1);
  assert.equal(publicAgentDecrypted.optionIndex, 2);
  assert.equal(publicAgentDecrypted.voter.toLowerCase(), publicAgent.address.toLowerCase());

  const tally = [1, 1, 1];
  const transcript = JSON.stringify({
    proposalId: proposalId.toString(),
    tally,
    ballots: [encrypted.privateBallotHash, oneTimeEncrypted.privateBallotHash, publicAgentEncrypted.privateBallotHash]
  });
  const tallyProofHash = keccak256(toUtf8Bytes(transcript));
  const firstApproval = await deployed.approveThresholdTally(
    proposalId,
    tally,
    "ipfs://local-e2e-transcript",
    tallyProofHash,
    tallySecret
  );
  await firstApproval.wait();
  const secondApproval = await deployed.connect(committeeTwo).approveThresholdTally(
    proposalId,
    tally,
    "ipfs://local-e2e-transcript",
    tallyProofHash,
    tallySecret
  );
  await secondApproval.wait();

  const finalizedProposal = await deployed.getProposal(proposalId);
  assert.equal(finalizedProposal.finalized, true);
  assert.deepEqual(finalizedProposal.finalTally.map(Number), tally);

  console.log(JSON.stringify({
    result: "passed",
    chainId,
    proposalId: proposalId.toString(),
    delegatedAgentVoteRelayed: true,
    voterSignedVoteRelayed: true,
    publicAgentVoteRelayed: true,
    replayDeduplicated: true,
    decryptedOption: decrypted.optionIndex,
    finalTally: tally,
    finalized: finalizedProposal.finalized
  }, null, 2));
} finally {
  anvil.kill("SIGTERM");
  await new Promise((resolveExit) => {
    if (anvil.exitCode !== null) return resolveExit();
    anvil.once("exit", resolveExit);
    setTimeout(resolveExit, 1000);
  });
}
