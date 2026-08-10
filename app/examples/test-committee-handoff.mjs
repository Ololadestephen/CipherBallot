import assert from "node:assert/strict";
import {
  decryptCommitteeHandoff,
  encryptCommitteeHandoff,
  generateCommitteeHandoffKey
} from "../src/lib/committeeHandoff.ts";
import { normalizeProposalCode, proposalCode } from "../src/lib/proposalCode.ts";
import { proposalCodeFor } from "../api/_lib/proposal-code.js";

const context = {
  chainId: 968,
  contractAddress: "0x1111111111111111111111111111111111111111"
};
const proposalId = 42;
const recoveryKit = JSON.stringify({
  format: "cipherballot-election-recovery-v1",
  electionPrivateKey: `0x${"11".repeat(32)}`,
  committeeTallySecret: `0x${"22".repeat(32)}`
});
const handoffKey = generateCommitteeHandoffKey();
const encrypted = await encryptCommitteeHandoff(proposalId, recoveryKit, handoffKey, context);
process.env.BOTCHAIN_CHAIN_ID = String(context.chainId);
process.env.CIPHERBALLOT_CONTRACT_ADDRESS = context.contractAddress;
process.env.AGENT_RELAY_STORE = "memory";
const { validateHandoffPackage } = await import("../api/v1/committee.js");

assert.equal(await decryptCommitteeHandoff(proposalId, encrypted, handoffKey, context), recoveryKit);
assert.deepEqual(validateHandoffPackage(encrypted, proposalId), encrypted);
assert.throws(() => validateHandoffPackage({ ...encrypted, plaintext: recoveryKit }, proposalId), /unknown fields/);
await assert.rejects(() => decryptCommitteeHandoff(proposalId + 1, encrypted, handoffKey, context));
await assert.rejects(() => decryptCommitteeHandoff(proposalId, encrypted, generateCommitteeHandoffKey(), context));

const code = proposalCode(proposalId, context);
assert.equal(proposalCodeFor(context.chainId, context.contractAddress, proposalId), code);
assert.match(code, /^CB-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
assert.equal(normalizeProposalCode(code.toLowerCase()), normalizeProposalCode(code));
assert.notEqual(proposalCode(proposalId + 1, context), code);

console.log(JSON.stringify({ result: "passed", proposalCode: code, contextBound: true, wrongKeyRejected: true }, null, 2));
