import { expect } from "chai";
import { readFileSync } from "fs";

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("confidential_vote privacy contract", () => {
  const idl = readJson("target/idl/confidential_vote.json");
  const programSource = readFileSync("programs/confidential_vote/src/lib.rs", "utf8");
  const circuitSource = readFileSync("encrypted-ixs/src/lib.rs", "utf8");

  function instruction(name: string): any {
    const item = idl.instructions.find((ix: any) => ix.name === name);
    expect(item, `missing instruction ${name}`).to.exist;
    return item;
  }

  it("cast_vote accepts encrypted vote material only", () => {
    const args = instruction("cast_vote").args.map((arg: any) => arg.name);

    expect(args).to.deep.equal([
      "voter_x25519_pubkey",
      "nonce",
      "encrypted_vote",
      "computation_offset"
    ]);
    expect(args).not.to.include("vote_index");
    expect(args).not.to.include("option_index");
    expect(programSource).not.to.match(/vote_index/i);
    expect(programSource).not.to.match(/option_index/i);
  });

  it("queues Arcium computations instead of mutating public tallies directly", () => {
    expect(programSource).to.include("queue_computation_with_callback_fee(");
    expect(programSource).to.include("InitTallyCallback::callback_ix");
    expect(programSource).to.include("ApplyVoteCallback::callback_ix");
    expect(programSource).to.include("RevealTallyCallback::callback_ix");
    expect(programSource).to.include("COMP_DEF_INIT_TALLY");
    expect(programSource).to.include("COMP_DEF_APPLY_VOTE");
    expect(programSource).to.include("COMP_DEF_REVEAL_TALLY");
  });

  it("verifies signed Arcium callback output before changing program state", () => {
    expect(programSource).to.include("verify_output_raw");
    expect(programSource).to.include("validate_callback_ixs");
    expect(programSource).to.include("require_keys_eq!(prev_ix.program_id, *arcium_program");
    expect(programSource).to.include("InvalidCallbackSignature");
  });

  it("keeps results hidden until reveal_tally callback", () => {
    const accountNames = (idl.accounts ?? []).map((account: any) => account.name.toLowerCase());

    expect(accountNames).to.include("proposal");
    expect(accountNames).to.include("encryptedtally");
    expect(programSource).to.match(/proposal\.results\s*=\s*Vec::new\(\)/);
    expect(programSource).to.match(/proposal\.results\s*=\s*results/);
  });

  it("implements encrypted Arcis tally mutation and final reveal circuits", () => {
    expect(circuitSource).to.include("pub fn init_tally(");
    expect(circuitSource).to.include("pub fn apply_vote(");
    expect(circuitSource).to.include("pub fn reveal_tally(");
    expect(circuitSource).to.include("Enc<Shared, VoteInput>");
    expect(circuitSource).to.include("Enc<Mxe, TallyState>");
    expect(circuitSource).not.to.match(/vote_index/i);
  });

  it("exposes deployment hooks for all Arcium computation definitions", () => {
    expect(instruction("init_init_tally_comp_def")).to.exist;
    expect(instruction("init_apply_vote_comp_def")).to.exist;
    expect(instruction("init_reveal_tally_comp_def")).to.exist;
  });
});
