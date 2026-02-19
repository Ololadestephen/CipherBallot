import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { ConfidentialVote } from "../target/types/confidential_vote";
import { ArciumClient } from "@arcium-hq/client";
import { PublicKey, SystemProgram } from "@solana/web3.js";

describe("Initialize Arcium Definitions", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.ConfidentialVote as Program<ConfidentialVote>;

    it("Initializes computation definitions", async () => {
        const client = new ArciumClient();

        // 1. initInitTallyCompDef
        try {
            console.log("Initializing init_tally definition...");
            const tx = await program.methods
                .initInitTallyCompDef()
                .rpc();
            console.log("init_tally success:", tx);
        } catch (err) {
            console.log("init_tally skipped/failed:", err);
        }

        // 2. initApplyVoteCompDef
        try {
            console.log("Initializing apply_vote definition...");
            const tx = await program.methods
                .initApplyVoteCompDef()
                .rpc();
            console.log("apply_vote success:", tx);
        } catch (err) {
            console.log("apply_vote skipped/failed:", err);
        }

        // 3. initRevealTallyCompDef
        try {
            console.log("Initializing reveal_tally definition...");
            const tx = await program.methods
                .initRevealTallyCompDef()
                .rpc();
            console.log("reveal_tally success:", tx);
        } catch (err) {
            console.log("reveal_tally skipped/failed:", err);
        }
    });
});
