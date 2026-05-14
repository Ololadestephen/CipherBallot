import { PublicKey, Connection, Keypair, Transaction, TransactionInstruction } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import * as arcium from '@arcium-hq/client';
import BN from 'bn.js';
import fs from 'fs';
import path from 'path';

const PROGRAM_ID = new PublicKey('833fAPgL1hjhonBa349E5UyGpP7dUdmiTELuJe3pbAXW');
const LUT_PROGRAM_ID = new PublicKey('AddressLookupTab1e1111111111111111111111111');
const CLUSTER_OFFSET = Number(process.env.ARCIUM_CLUSTER_OFFSET ?? 456);
const RPC_URL = process.env.ANCHOR_PROVIDER_URL ?? process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';

function readWallet() {
  const walletPath = process.env.ANCHOR_WALLET || path.join(process.env.HOME, '.config/solana/id.json');
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf8'))));
}

function compDefOffset(label) {
  return Buffer.from(arcium.getCompDefAccOffset(label)).readUInt32LE(0);
}

async function maybeInitMxe(provider) {
  const connection = provider.connection;
  const mxeAccount = arcium.getMXEAccAddress(PROGRAM_ID);
  const currentSlot = await connection.getSlot('confirmed');

  try {
    await arcium.initMxePart1(provider, PROGRAM_ID);
    console.log('initMxePart1: ok');
  } catch (err) {
    console.log('initMxePart1:', err?.message ?? err);
  }

  try {
    await arcium.initMxePart2(
      provider,
      new BN(CLUSTER_OFFSET),
      PROGRAM_ID,
      [3189227886, 1868227617, 2504929299, 36360610],
      new BN(currentSlot),
      new BN(currentSlot + 1),
      new BN(currentSlot),
    );
    console.log('initMxePart2: ok');
  } catch (err) {
    console.log('initMxePart2:', err?.message ?? err);
  }

  const info = await connection.getAccountInfo(mxeAccount, 'confirmed');
  if (!info) throw new Error(`MXE account missing: ${mxeAccount.toBase58()}`);
  return mxeAccount;
}

async function sendRawProgramIx(provider, idl, ixName, keys) {
  const ixDef = idl.instructions.find((ix) => ix.name === ixName);
  if (!ixDef?.discriminator) throw new Error(`Missing IDL discriminator for ${ixName}`);
  const tx = new Transaction().add(new TransactionInstruction({
    programId: PROGRAM_ID,
    data: Buffer.from(ixDef.discriminator),
    keys,
  }));
  return provider.sendAndConfirm(tx);
}

async function initCompDef({ provider, idl, mxeAccount, ixName, label }) {
  const arciumProgram = arcium.getArciumProgramId();
  const arciumProgramHandle = arcium.getArciumProgram(provider);
  const mxeData = await arciumProgramHandle.account.mxeAccount.fetch(mxeAccount);
  const lutOffset = mxeData.lutOffsetSlot;
  const addressLookupTable = arcium.getLookupTableAddress(PROGRAM_ID, lutOffset);
  const compDefAcc = arcium.getCompDefAccAddress(PROGRAM_ID, compDefOffset(label));

  const existing = await provider.connection.getAccountInfo(compDefAcc, 'confirmed');
  if (existing && !existing.owner.equals(anchor.web3.SystemProgram.programId)) {
    console.log(`${label} comp-def already initialized: ${compDefAcc.toBase58()}`);
  } else {
    const sig = await sendRawProgramIx(provider, idl, ixName, [
      { pubkey: provider.wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: arciumProgram, isSigner: false, isWritable: false },
      { pubkey: mxeAccount, isSigner: false, isWritable: true },
      { pubkey: compDefAcc, isSigner: false, isWritable: true },
      { pubkey: addressLookupTable, isSigner: false, isWritable: true },
      { pubkey: LUT_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: anchor.web3.SystemProgram.programId, isSigner: false, isWritable: false },
    ]);
    console.log(`${label} comp-def initialized: ${sig}`);
  }

  console.log(`${label} circuit source: off-chain URL embedded in program`);
}

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  const wallet = new anchor.Wallet(readWallet());
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'target', 'idl', 'confidential_vote.json'), 'utf8'));

  console.log('Program:', PROGRAM_ID.toBase58());
  console.log('RPC:', RPC_URL.replace(/api-key=[^&\s]+/i, 'api-key=***'));
  console.log('Circuit storage: off-chain URL');
  const mxeAccount = await maybeInitMxe(provider);
  console.log('MXE:', mxeAccount.toBase58());

  for (const item of [
    { ixName: 'init_init_tally_comp_def', label: 'init_tally' },
    { ixName: 'init_apply_vote_comp_def', label: 'apply_vote' },
    { ixName: 'init_reveal_tally_comp_def', label: 'reveal_tally' },
  ]) {
    await initCompDef({ provider, idl, mxeAccount, ...item });
  }

  console.log('Arcium setup complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
