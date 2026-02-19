import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import idlJson from "../idl/confidential_vote.json";
import { Buffer } from "buffer";

const PROGRAM_ID_STR = "Bc7u1THDttJMjzbdhestYiXPqq8XxCJMpfeDzU54h66L";
const PROGRAM_ID = new PublicKey(PROGRAM_ID_STR);
const MAX_OPTIONS = 8;

const IDL = {
  ...(idlJson as anchor.Idl),
  address: PROGRAM_ID.toBase58()
} as anchor.Idl;

let arciumClientPromise: Promise<any> | null = null;
async function getArciumClient() {
  if (!(globalThis as any).Buffer) {
    (globalThis as any).Buffer = Buffer;
  }
  if (!arciumClientPromise) {
    arciumClientPromise = import("@arcium-hq/client");
  }
  return arciumClientPromise;
}

function getRandomBytes(len: number): Uint8Array {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return bytes;
}

export async function getMxePublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  retries = 6,
  delayMs = 1000
): Promise<Uint8Array> {
  const client = await getArciumClient();
  const mxeAccount = client.getMXEAccAddress(PROGRAM_ID);
  const mxeInfo = await provider.connection.getAccountInfo(mxeAccount, "confirmed");
  if (!mxeInfo) {
    throw new Error(
      `Arcium MXE account not found for program ${PROGRAM_ID.toBase58()} on ${provider.connection.rpcEndpoint}.`
    );
  }
  let lastError: unknown;
  for (let i = 0; i < retries; i += 1) {
    try {
      const mxePubkey = await client.getMXEPublicKey(provider, PROGRAM_ID);
      if (mxePubkey && mxePubkey.length) {
        return mxePubkey;
      }
      lastError = new Error(
        "MXE public key not available on this cluster yet."
      );
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw lastError ?? new Error("Failed to fetch MXE public key");
}

export async function checkArciumReadiness(provider: anchor.AnchorProvider): Promise<{
  ready: boolean;
  reason: string;
  mxeAccount: string;
  clusterOffset: number;
}> {
  const client = await getArciumClient();
  const mxeAccount = client.getMXEAccAddress(PROGRAM_ID);
  const mxeInfo = await provider.connection.getAccountInfo(mxeAccount, "confirmed");
  if (!mxeInfo) {
    return {
      ready: false,
      reason: `MXE account is not initialized for program ${PROGRAM_ID.toBase58()}.`,
      mxeAccount: mxeAccount.toBase58(),
      clusterOffset: 456
    };
  }

  try {
    const mxePubkey = await client.getMXEPublicKey(provider, PROGRAM_ID);
    if (mxePubkey && mxePubkey.length > 0) {
      return {
        ready: true,
        reason: "Arcium MXE is ready.",
        mxeAccount: mxeAccount.toBase58(),
        clusterOffset: 456
      };
    }
  } catch (err) {
    return {
      ready: false,
      reason: err instanceof Error ? err.message : String(err),
      mxeAccount: mxeAccount.toBase58(),
      clusterOffset: 456
    };
  }

  return {
    ready: false,
    reason: "MXE keys are not finalized yet.",
    mxeAccount: mxeAccount.toBase58(),
    clusterOffset: 456
  };
}

export async function encryptVote(optionIndex: number, provider: anchor.AnchorProvider) {
  const client = await getArciumClient();
  const mxePublicKey = await getMxePublicKeyWithRetry(provider);
  const clientPrivateKey = client.x25519.utils.randomSecretKey();
  const clientPublicKey = client.x25519.getPublicKey(clientPrivateKey);
  const sharedSecret = client.x25519.getSharedSecret(clientPrivateKey, mxePublicKey);
  const cipher = new client.RescueCipher(sharedSecret);
  const nonceBytes = getRandomBytes(16);
  const nonce = client.deserializeLE(nonceBytes);

  const ciphertext = cipher.encrypt([BigInt(optionIndex)], nonceBytes);

  return {
    voterX25519Pubkey: Array.from(clientPublicKey),
    nonce: new anchor.BN(nonce.toString()),
    encryptedVote: Array.from(ciphertext[0])
  };
}

export async function encryptInitialTally(provider: anchor.AnchorProvider, optionsCount: number) {
  const client = await getArciumClient();
  const mxePublicKey = await getMxePublicKeyWithRetry(provider);
  const clientPrivateKey = client.x25519.utils.randomSecretKey();
  const clientPublicKey = client.x25519.getPublicKey(clientPrivateKey);
  const sharedSecret = client.x25519.getSharedSecret(clientPrivateKey, mxePublicKey);
  const cipher = new client.RescueCipher(sharedSecret);
  const nonceBytes = getRandomBytes(16);
  const nonce = client.deserializeLE(nonceBytes);

  const paddedCount = Math.min(Math.max(optionsCount, 2), MAX_OPTIONS);
  const plaintext = Array.from({ length: MAX_OPTIONS }).map((_, idx) =>
    idx < paddedCount ? BigInt(0) : BigInt(0)
  );

  const ciphertext = cipher.encrypt(plaintext, nonceBytes);

  return {
    creatorX25519Pubkey: Array.from(clientPublicKey),
    nonce: new anchor.BN(nonce.toString()),
    encryptedTally: ciphertext.map((item) => Array.from(item))
  };
}

export async function createProposal(params: {
  provider: anchor.AnchorProvider;
  proposalSalt: number[]; // 8 bytes
  title: string;
  options: string[];
  startTs: number;
  endTs: number;
  eligibilityMode: number;
  whitelist?: string[];
}) {
  const {
    provider,
    proposalSalt,
    title,
    options,
    startTs,
    endTs,
    eligibilityMode,
    whitelist = []
  } = params;

  const program = new anchor.Program(IDL, provider);
  const proposal = PublicKey.findProgramAddressSync(
    [
      Buffer.from("proposal"),
      provider.wallet.publicKey.toBuffer(),
      Buffer.from(proposalSalt)
    ],
    PROGRAM_ID
  )[0];

  // Convert whitelist PublicKeys to 32-byte arrays for IDL matching
  const parsedWhitelist = whitelist.map((value) => Array.from(new PublicKey(value).toBytes()));

  console.log("[arcium] Creating proposal with 128-byte padding...");

  const sig = await program.methods
    .createProposal(
      proposalSalt,
      title.padEnd(128, "\0").slice(0, 128).split("").map(c => c.charCodeAt(0)),
      options.map(opt => opt.padEnd(128, "\0").slice(0, 128).split("").map(c => c.charCodeAt(0))),
      new anchor.BN(startTs),
      new anchor.BN(endTs),
      eligibilityMode,
      parsedWhitelist
    )
    .accountsPartial({
      creator: provider.wallet.publicKey,
      proposal,
      mint: SystemProgram.programId, // Dummy
      systemProgram: SystemProgram.programId
    })
    .rpc();

  return { sig, proposal };
}

export async function initEncryptedTally(params: {
  provider: anchor.AnchorProvider;
  proposalPubkey: PublicKey;
  optionsCount: number;
}) {
  const { provider, proposalPubkey, optionsCount } = params;
  const program = new anchor.Program(IDL, provider);

  const encryptedTally = PublicKey.findProgramAddressSync(
    [Buffer.from("encrypted_tally"), proposalPubkey.toBuffer()],
    PROGRAM_ID
  )[0];

  const { creatorX25519Pubkey, nonce, encryptedTally: encryptedInput } =
    await encryptInitialTally(provider, optionsCount);

  const sig = await program.methods
    .initTally(creatorX25519Pubkey, nonce, encryptedInput)
    .accountsPartial({
      creator: provider.wallet.publicKey,
      proposal: proposalPubkey,
      encryptedTally,
      systemProgram: SystemProgram.programId
    })
    .rpc();

  return sig;
}

export async function finalizeEncryptedTally(params: {
  provider: anchor.AnchorProvider;
  proposalPubkey: PublicKey;
  // results: number[]; // Removed in Hybrid/Demo Mode
}) {
  const { provider, proposalPubkey } = params;
  const program = new anchor.Program(IDL, provider);

  const sig = await program.methods
    .finalizeTally()
    .accountsPartial({
      creator: provider.wallet.publicKey,
      proposal: proposalPubkey,
    })
    .rpc();

  return sig;
}

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

function getAssociatedTokenAddress(mint: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      owner.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      mint.toBuffer()
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

export async function submitEncryptedVote(params: {
  provider: anchor.AnchorProvider;
  proposalPubkey: PublicKey;
  optionIndex: number;
  mint?: PublicKey;
}) {
  const { provider, proposalPubkey, optionIndex, mint } = params;
  const program = new anchor.Program(IDL, provider);

  const encryptedTally = PublicKey.findProgramAddressSync(
    [Buffer.from("encrypted_tally"), proposalPubkey.toBuffer()],
    PROGRAM_ID
  )[0];

  const { voterX25519Pubkey, nonce, encryptedVote } = await encryptVote(
    optionIndex,
    provider
  );

  const voterRecord = PublicKey.findProgramAddressSync(
    [
      Buffer.from("voter"),
      provider.wallet.publicKey.toBuffer(),
      proposalPubkey.toBuffer()
    ],
    PROGRAM_ID
  )[0];

  let remainingAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
  let voterToken: PublicKey | null = null;

  if (mint) {
    voterToken = getAssociatedTokenAddress(mint, provider.wallet.publicKey);
  }

  // Pure manual TransactionInstruction to eliminate all Anchor client magic
  const ixData = program.coder.instruction.encode("castVote", {
    voterX25519Pubkey,
    nonce,
    encryptedVote,
    voteIndex: optionIndex
  });

  const keys = [
    { pubkey: provider.wallet.publicKey, isSigner: true, isWritable: true }, // voter
    { pubkey: proposalPubkey, isSigner: false, isWritable: true }, // proposal
    { pubkey: encryptedTally, isSigner: false, isWritable: true }, // encrypted_tally
    { pubkey: voterRecord, isSigner: false, isWritable: true }, // voter_record
    { pubkey: voterToken || PROGRAM_ID, isSigner: false, isWritable: false }, // voter_token (Optional/None)
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
  ];

  console.log("[arcium.ts] DEBUG: Pure Keys:", keys.map(k => k.pubkey.toBase58()));

  const ix = new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data: ixData
  });

  const tx = new Transaction().add(ix);
  const sig = await provider.sendAndConfirm(tx);
  return sig;
}

export async function hasUserVoted(provider: anchor.AnchorProvider, proposalPubkey: PublicKey): Promise<boolean> {
  const voterRecord = PublicKey.findProgramAddressSync(
    [
      Buffer.from("voter"),
      provider.wallet.publicKey.toBuffer(),
      proposalPubkey.toBuffer()
    ],
    PROGRAM_ID
  )[0];
  const info = await provider.connection.getAccountInfo(voterRecord);
  return info !== null;
}
