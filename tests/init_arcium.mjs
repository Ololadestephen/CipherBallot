import { PublicKey, Connection, Keypair, Transaction, TransactionInstruction } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import * as arcium from '@arcium-hq/client';
import BN from 'bn.js';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

const PROGRAM_ID = new PublicKey("Bc7u1THDttJMjzbdhestYiXPqq8XxCJMpfeDzU54h66L");
const ARCIUM_PROGRAM_ID = new PublicKey("Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ");
const LUT_PROGRAM_ID = new PublicKey("AddressLookupTab1e1111111111111111111111111");
const CLUSTER_OFFSET = 456;

// Use Arcium SDK's logic if possible, otherwise fallback to known hash
function getOffsetLocal(label) {
    const hash = createHash('sha256').update(label).digest();
    return hash.readUInt32LE(0);
}

async function main() {
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");

    const walletPath = process.env.ANCHOR_WALLET || path.join(process.env.HOME, ".config/solana/id.json");
    const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const keypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
    const wallet = new anchor.Wallet(keypair);
    const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

    console.log("Starting Arcium initialization for Program:", PROGRAM_ID.toBase58());

    const mxeAccount = arcium.getMXEAccAddress(PROGRAM_ID);
    console.log("Derived MXE Account:", mxeAccount.toBase58());

    const currentSlot = await connection.getSlot();

    console.log("Attempting MXE Part 1...");
    try {
        await arcium.initMxePart1(provider, PROGRAM_ID);
        console.log("✅ initMxePart1 successful");
    } catch (e) {
        if (e.message.includes("already in use")) {
            console.log("ℹ️ initMxePart1 accounts already allocated.");
        } else {
            console.log("ℹ️ initMxePart1 status:", e.message);
        }
    }

    const RECOVERY_PEERS = [3189227886, 1868227617, 2504929299, 36360610];

    console.log("Attempting MXE Part 2...");
    try {
        await arcium.initMxePart2(
            provider,
            new BN(CLUSTER_OFFSET),
            PROGRAM_ID,
            RECOVERY_PEERS,
            new BN(currentSlot),
            new BN(currentSlot + 1),
            new BN(currentSlot)
        );
        console.log("✅ initMxePart2 successful");
    } catch (e) {
        console.log("ℹ️ initMxePart2 status:", e.message);
    }

    // --- Comp Def Initialization ---

    const mxeInfo = await connection.getAccountInfo(mxeAccount);
    if (!mxeInfo) {
        console.error("❌ MXE account DOES NOT EXIST. Cannot proceed.");
        return;
    }

    const program = arcium.getArciumProgram(provider);
    let mxeData;
    try {
        mxeData = await program.account.mxeAccount.fetch(mxeAccount);
    } catch (err) {
        console.error("❌ Failed to fetch MXE account data:", err);
        return;
    }
    const lutOffset = mxeData.lutOffsetSlot;
    console.log(`✅ MXE checked. LUT Offset: ${lutOffset}`);

    const instructions = [
        {
            name: "init_init_tally_comp_def",
            discriminator: [73, 66, 154, 157, 133, 123, 179, 243],
            label: "init_tally",
            circuitFile: "init_tally.arcis"
        },
        {
            name: "init_apply_vote_comp_def",
            discriminator: [0, 177, 159, 17, 4, 180, 255, 237],
            label: "apply_vote",
            circuitFile: "apply_vote.arcis"
        },
        {
            name: "init_reveal_tally_comp_def",
            discriminator: [107, 78, 64, 206, 75, 159, 140, 88],
            label: "reveal_tally",
            circuitFile: "reveal_tally.arcis"
        }
    ];

    for (const ix of instructions) {
        let offset;
        // Try to use SDK function if available
        if (typeof arcium.getCompDefAccOffset === 'function') {
            const buf = arcium.getCompDefAccOffset(ix.label);
            // Buffer to number
            offset = Buffer.from(buf).readUInt32LE(0);
            console.log(`Computed offset via SDK for ${ix.label}: ${offset}`);
        } else {
            // Fallback
            offset = getOffsetLocal(ix.label);
            console.log(`Computed offset via LOCAL for ${ix.label}: ${offset}`);
        }

        const compDefAccount = arcium.getCompDefAccAddress(PROGRAM_ID, offset);
        const lutAddress = arcium.getLookupTableAddress(PROGRAM_ID, lutOffset);

        // --- STEP 1: Send Init Transaction ---

        // Check if already init
        const beforeInfo = await connection.getAccountInfo(compDefAccount);
        if (beforeInfo && !beforeInfo.owner.equals(anchor.web3.SystemProgram.programId)) {
            console.log(`ℹ️ Account ${compDefAccount.toBase58()} seems initialized (Owner: ${beforeInfo.owner.toBase58()}).`);
        } else {
            console.log(`Sending ${ix.name} (offset ${offset})...`);
            try {
                const transaction = new Transaction().add(
                    new TransactionInstruction({
                        programId: PROGRAM_ID,
                        keys: [
                            { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
                            { pubkey: mxeAccount, isSigner: false, isWritable: true },
                            { pubkey: compDefAccount, isSigner: false, isWritable: true },
                            { pubkey: lutAddress, isSigner: false, isWritable: true },
                            { pubkey: LUT_PROGRAM_ID, isSigner: false, isWritable: false },
                            { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false },
                            { pubkey: anchor.web3.SystemProgram.programId, isSigner: false, isWritable: false },
                        ],
                        data: Buffer.from(ix.discriminator),
                    })
                );

                const sig = await provider.sendAndConfirm(transaction);
                console.log(`✅ ${ix.name} success: ${sig}`);
            } catch (e) {
                if (e.message.includes("already in use")) {
                    console.log(`ℹ️ ${ix.name} already in use.`);
                } else {
                    console.error(`❌ ${ix.name} transaction failed:`, e.message);
                }
            }
        }

        // --- STEP 2: SDK Upload (Handles InitRaw, Multi-Chunk Upload, and Finalize) ---
        console.log(`Uploading bytecode for ${ix.label} using SDK's uploadCircuit...`);
        try {
            const circuitPath = path.join(process.cwd(), "build", ix.circuitFile);
            const circuitData = fs.readFileSync(circuitPath);
            console.log(`Read ${circuitData.length} bytes from ${ix.circuitFile}`);

            // This SDK function handles the complex chunked upload logic
            const sigs = await arcium.uploadCircuit(
                provider,
                ix.label,
                PROGRAM_ID,
                circuitData,
                true // logging
            );
            console.log(`✅ ${ix.label} initialization & upload complete! Signatures:`, sigs);
        } catch (e) {
            console.error(`❌ ${ix.label} upload failed:`, e.message);
            if (e.logs) console.log("Logs:", e.logs);
        }
    }

    console.log("\nArcium initialization script finished.");
}

main().catch(console.error);
