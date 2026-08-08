import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import {
  agentWalletFromEnvironment,
  createAgentRuntime,
  inspectProposalBrief,
  readVoteStatus,
  submitSignedVotePacket,
  voteWithAgent
} from "./lib/agent-client.mjs";

function usage() {
  return `CipherBallot agent CLI

Usage:
  npm run agent -- inspect '<proposal-brief-json>'
  npm run agent -- vote-as-agent '<proposal-brief-json>' --option 0
  npm run agent -- vote-for-voter '<proposal-brief-json>' --option 0 [--voter 0x...]
  npm run agent -- submit-signed '<signed-vote-json>'
  npm run agent -- status cb_RelayJobId
  npm run agent -- status 0xTransactionHash

Use @path/to/packet.json instead of inline JSON to read a packet from a file.
Agent signing commands require AGENT_PRIVATE_KEY. Delegated voting also requires
the voter in the brief, --voter, or VOTER_ADDRESS.`;
}

async function packetArgument(value) {
  if (!value) throw new Error("A CipherBallot packet is required.");
  if (!value.startsWith("@")) return value;
  const [root, packetPath] = await Promise.all([
    realpath(process.cwd()),
    realpath(resolve(process.cwd(), value.slice(1)))
  ]);
  const localPath = relative(root, packetPath);
  if (!localPath || localPath.startsWith("..") || isAbsolute(localPath)) {
    throw new Error("Packet files must be inside the current project directory.");
  }
  if (extname(packetPath).toLowerCase() !== ".json") throw new Error("Packet files must use the .json extension.");
  const details = await stat(packetPath);
  if (!details.isFile() || details.size > 16_384) throw new Error("Packet files must be regular JSON files no larger than 16 KB.");
  return readFile(packetPath, "utf8");
}

function publicVoteResult(result) {
  return {
    status: result.status,
    mode: result.mode,
    ballotOwner: result.ballotOwner,
    jobId: result.jobId,
    txHash: result.txHash,
    explorerUrl: result.explorerUrl,
    statusUrl: result.statusUrl
  };
}

function optionValue(args) {
  const index = args.indexOf("--option");
  const raw = index >= 0 ? args[index + 1] : process.env.OPTION_INDEX;
  const option = Number(raw);
  if (!Number.isInteger(option) || option < 0) throw new Error("Provide a non-negative --option index.");
  return option;
}

function namedValue(args, name, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

const [, , command, first, ...rest] = process.argv;

if (!command || command === "help" || command === "--help" || command === "-h") {
  console.log(usage());
  process.exit(0);
}

try {
  const runtime = createAgentRuntime();
  let result;

  if (command === "inspect") {
    const inspected = await inspectProposalBrief(runtime, await packetArgument(first));
    result = {
      chainId: runtime.chainId,
      contract: runtime.contractAddress,
      proposal: inspected.proposal,
      requestedVoter: inspected.brief.voter || null
    };
  } else if (command === "vote-as-agent") {
    const wallet = agentWalletFromEnvironment(runtime);
    result = publicVoteResult(await voteWithAgent(runtime, {
      mode: "public-agent",
      agentWallet: wallet,
      brief: await packetArgument(first),
      optionIndex: optionValue(rest),
      deadlineSeconds: Number(process.env.AGENT_VOTE_DEADLINE_SECONDS || 900)
    }));
  } else if (command === "vote-for-voter") {
    const wallet = agentWalletFromEnvironment(runtime);
    result = publicVoteResult(await voteWithAgent(runtime, {
      mode: "delegated",
      agentWallet: wallet,
      brief: await packetArgument(first),
      optionIndex: optionValue(rest),
      voter: namedValue(rest, "--voter", process.env.VOTER_ADDRESS),
      deadlineSeconds: Number(process.env.AGENT_VOTE_DEADLINE_SECONDS || 900)
    }));
  } else if (command === "submit-signed") {
    result = await submitSignedVotePacket(runtime, await packetArgument(first));
  } else if (command === "status") {
    result = await readVoteStatus(runtime, first);
  } else {
    throw new Error(`Unknown command: ${command}.\n\n${usage()}`);
  }

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
}
