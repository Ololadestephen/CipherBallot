import { Contract, Interface, JsonRpcProvider, getAddress, isAddress, keccak256, toUtf8Bytes } from "ethers";
import { decryptBallot, encryptedBallotProofHash, publicKeyFromPrivateKey } from "./lib/ballot-envelope.mjs";

const required = ["ELECTION_PRIVATE_KEY", "PROPOSAL_ID", "CIPHERBALLOT_CONTRACT_ADDRESS"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing ${name}.`);
}

const chainId = 968;
const rpcUrl = process.env.BOTCHAIN_RPC_URL || "https://rpc.bohr.life";
const contractAddress = process.env.CIPHERBALLOT_CONTRACT_ADDRESS;
if (!/^[1-9][0-9]*$/.test(process.env.PROPOSAL_ID)) throw new Error("PROPOSAL_ID must be a positive integer.");
const proposalId = BigInt(process.env.PROPOSAL_ID);
const fromBlock = Number(process.env.DEPLOYMENT_BLOCK || 0);
if (!isAddress(contractAddress)) throw new Error("Invalid CIPHERBALLOT_CONTRACT_ADDRESS.");
if (!Number.isSafeInteger(fromBlock) || fromBlock < 0) throw new Error("DEPLOYMENT_BLOCK must be a non-negative integer.");

const abi = [
  "event PrivateBallotSubmitted(uint256 indexed proposalId,address indexed voter,bytes32 privateBallotHash,bytes32 ballotProofHash)",
  "function getProposal(uint256 proposalId) view returns (address creator,string title,string[] options,uint64 startTime,uint64 endTime,uint64 revealDeadline,bool allowlistEnabled,uint256 allowedVoterCount,bool finalized,uint256 voteCount,uint256 revealCount,uint256[] finalTally)",
  "function getEncryptionPublicKey(uint256 proposalId) view returns (bytes)",
  "function submitPrivateBallot(uint256 proposalId,bytes privateBallot,bytes32 ballotProofHash)",
  "function submitPrivateBallotByAgent(uint256 proposalId,address voter,address agent,bytes privateBallot,bytes32 ballotProofHash,uint256 nonce,uint64 deadline,bytes signature)",
  "function submitPrivateBallotByVoterSignature(uint256 proposalId,address voter,bytes privateBallot,bytes32 ballotProofHash,uint256 nonce,uint64 deadline,bytes signature)",
  "function submitPublicAgentBallot(uint256 proposalId,address agent,bytes privateBallot,bytes32 ballotProofHash,uint256 nonce,uint64 deadline,bytes signature)"
];
const provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
const contract = new Contract(contractAddress, abi, provider);
const iface = new Interface(abi);
const [rpcChainId, code] = await Promise.all([provider.send("eth_chainId", []), provider.getCode(contractAddress)]);
if (BigInt(rpcChainId) !== BigInt(chainId)) throw new Error(`RPC chain ID ${BigInt(rpcChainId)} does not match ${chainId}.`);
if (code === "0x") throw new Error("No contract is deployed at CIPHERBALLOT_CONTRACT_ADDRESS.");
const proposal = await contract.getProposal(proposalId);
const encryptionPublicKey = await contract.getEncryptionPublicKey(proposalId);
if (publicKeyFromPrivateKey(process.env.ELECTION_PRIVATE_KEY).toLowerCase() !== encryptionPublicKey.toLowerCase()) {
  throw new Error("ELECTION_PRIVATE_KEY does not match this proposal's public key.");
}
const latest = await provider.getBlock("latest");
if (!latest || latest.timestamp <= Number(proposal.endTime)) {
  throw new Error("Refusing to decrypt ballots before the proposal voting deadline.");
}

const events = await contract.queryFilter(contract.filters.PrivateBallotSubmitted(proposalId), fromBlock, "latest");
if (BigInt(events.length) !== BigInt(proposal.voteCount)) {
  throw new Error(
    `Found ${events.length} ballot events but the contract records ${proposal.voteCount}. Check DEPLOYMENT_BLOCK and RPC history.`
  );
}
const tally = Array.from({ length: proposal.options.length }, () => 0);
const transcript = [];
const seenVoters = new Set();
const ballotMethods = new Set([
  "submitPrivateBallot",
  "submitPrivateBallotByAgent",
  "submitPrivateBallotByVoterSignature",
  "submitPublicAgentBallot"
]);

for (const event of events) {
  const transaction = await provider.getTransaction(event.transactionHash);
  if (!transaction) throw new Error(`Missing transaction ${event.transactionHash}.`);
  if (!transaction.to || getAddress(transaction.to) !== getAddress(contractAddress)) {
    throw new Error(`Ballot transaction ${event.transactionHash} did not call the configured contract directly.`);
  }
  const parsed = iface.parseTransaction({ data: transaction.data, value: transaction.value });
  if (!parsed) throw new Error(`Unable to decode transaction ${event.transactionHash}.`);

  if (!ballotMethods.has(parsed.name)) {
    throw new Error(`Unexpected ballot transaction method in ${event.transactionHash}.`);
  }
  const privateBallot = parsed.args.privateBallot;
  const submittedProofHash = parsed.args.ballotProofHash;
  const voter = event.args.voter;
  const normalizedVoter = getAddress(voter);
  if (seenVoters.has(normalizedVoter)) throw new Error(`Duplicate ballot owner in ${event.transactionHash}.`);
  seenVoters.add(normalizedVoter);
  if (keccak256(privateBallot) !== event.args.privateBallotHash) throw new Error(`Ballot hash mismatch in ${event.transactionHash}.`);
  if (submittedProofHash !== event.args.ballotProofHash) throw new Error(`Event proof mismatch in ${event.transactionHash}.`);
  if (encryptedBallotProofHash(privateBallot) !== submittedProofHash) throw new Error(`Proof hash mismatch in ${event.transactionHash}.`);

  const ballot = decryptBallot({
    privateBallot,
    electionPrivateKey: process.env.ELECTION_PRIVATE_KEY,
    proposalId,
    chainId,
    contractAddress
  });
  if (BigInt(ballot.proposalId) !== proposalId || ballot.voter.toLowerCase() !== voter.toLowerCase()) {
    throw new Error(`Ballot context mismatch in ${event.transactionHash}.`);
  }
  if (!Number.isInteger(ballot.optionIndex) || ballot.optionIndex < 0 || ballot.optionIndex >= tally.length) {
    throw new Error(`Invalid option in ${event.transactionHash}.`);
  }

  tally[ballot.optionIndex]++;
  transcript.push({
    transactionHash: event.transactionHash,
    voter,
    privateBallotHash: event.args.privateBallotHash,
    ballotProofHash: submittedProofHash
  });
}

const transcriptJson = JSON.stringify({ proposalId: proposalId.toString(), tally, ballots: transcript });
console.log(JSON.stringify({
  proposalId: proposalId.toString(),
  title: proposal.title,
  options: proposal.options,
  finalTally: tally,
  ballotCount: transcript.length,
  tallyProofHash: keccak256(toUtf8Bytes(transcriptJson)),
  transcript
}, null, 2));
