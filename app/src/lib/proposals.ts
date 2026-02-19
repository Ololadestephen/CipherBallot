import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import idlJson from "../idl/confidential_vote.json";

const DEFAULT_PROGRAM_ID = "Bc7u1THDttJMjzbdhestYiXPqq8XxCJMpfeDzU54h66L";

function resolveProgramId(): PublicKey {
  const configured = (import.meta.env.VITE_PROGRAM_ID as string | undefined)?.trim();
  if (configured) {
    try {
      return new PublicKey(configured);
    } catch {
      console.warn(
        `[cipherballot] Invalid VITE_PROGRAM_ID "${configured}". Falling back to ${DEFAULT_PROGRAM_ID}.`
      );
    }
  }
  return new PublicKey(DEFAULT_PROGRAM_ID);
}

export const PROGRAM_ID = resolveProgramId();
const IDL = {
  ...(idlJson as anchor.Idl),
  address: PROGRAM_ID.toBase58()
} as anchor.Idl;

type RawProposal = {
  creator: PublicKey;
  title: number[];
  options: number[][];
  startTime?: anchor.BN;
  start_time?: anchor.BN;
  endTime?: anchor.BN;
  end_time?: anchor.BN;
  tallyInitialized?: boolean;
  tally_initialized?: boolean;
  finalized: boolean;
  results?: anchor.BN[];
  finalTally?: anchor.BN[];
  final_tally?: anchor.BN[];
  whitelist?: PublicKey[];
  eligibility_mode?: number;
  eligibilityMode?: number;
  voteCount?: anchor.BN;
  vote_count?: anchor.BN;
  vote_count?: anchor.BN;
  mint?: PublicKey;
};

export type ProposalStatus = "Active" | "Upcoming" | "Ended";

export type ProposalView = {
  address: string;
  creator: string;
  proposalId: number;
  title: string;
  options: string[];
  startTs: number;
  endTs: number;
  votesCast: number;
  tallyInitialized: boolean;
  finalized: boolean;
  finalTally: number[];
  encryptedTally: string;
  finalizationSig: number[];
  eligibilityMode: number;
  requiredMint: string;
  whitelist: string[];
  status: ProposalStatus;
};

const readonlyWallet: anchor.Wallet = {
  publicKey: PublicKey.default,
  signTransaction: async <T extends Transaction>(tx: T): Promise<T> => tx,
  signAllTransactions: async <T extends Transaction[]>(txs: T): Promise<T> => txs
};

function toNumber(value: unknown): number {
  if (value instanceof anchor.BN) {
    try {
      return value.toNumber();
    } catch {
      return 0; // Fallback or handle large numbers as strings if needed
    }
  }
  if (typeof value === "number") return value;
  return 0;
}

function deriveStatus(startTs: number, endTs: number, nowTs = Math.floor(Date.now() / 1000)): ProposalStatus {
  if (nowTs < startTs) return "Upcoming";
  if (nowTs > endTs) return "Ended";
  return "Active";
}

function mapProposal(address: PublicKey, account: RawProposal): ProposalView {
  // console.log("[cipherballot] Mapping proposal account:", account);
  const startTs = toNumber(account.startTime ?? account.start_time);
  const endTs = toNumber(account.endTime ?? account.end_time);
  const tallyInitialized = Boolean(account.tallyInitialized ?? account.tally_initialized);
  const results = (account.results ?? account.finalTally ?? account.final_tally ?? []).map((item) => toNumber(item));
  const whitelist = (account.whitelist ?? []).map((item) => item.toBase58());

  // Convert byte arrays to strings
  const title = String.fromCharCode(...(account.title || [])).replace(/\0/g, "").trim();
  const options = (account.options ?? []).map(opt =>
    String.fromCharCode(...opt).replace(/\0/g, "").trim()
  );

  const votesCast = toNumber(account.voteCount ?? account.vote_count ?? 0);
  const requiredMint = account.mint ? account.mint.toBase58() : "";

  return {
    address: address.toBase58(),
    creator: account.creator.toBase58(),
    proposalId: 0,
    title,
    options,
    startTs,
    endTs,
    votesCast,
    tallyInitialized,
    finalized: Boolean(account.finalized),
    finalTally: results,
    encryptedTally: "",
    finalizationSig: [],
    eligibilityMode: toNumber(account.eligibilityMode ?? account.eligibility_mode),
    requiredMint,
    whitelist,
    status: deriveStatus(startTs, endTs)
  };
}

async function getProgram(connection: Connection): Promise<anchor.Program> {
  const provider = new anchor.AnchorProvider(connection, readonlyWallet, { commitment: "confirmed" });
  return new anchor.Program(IDL, provider);
}

export async function fetchProposals(connection: Connection): Promise<ProposalView[]> {
  const program = await getProgram(connection);
  const rows = await program.account.proposal.all();
  return rows
    .map((row) => mapProposal(row.publicKey, row.account as RawProposal))
    .sort((a, b) => b.startTs - a.startTs);
}

export async function fetchProposalByAddress(connection: Connection, address: string): Promise<ProposalView> {
  const pubkey = new PublicKey(address);
  const program = await getProgram(connection);
  const account = (await program.account.proposal.fetch(pubkey)) as RawProposal;
  return mapProposal(pubkey, account);
}

export function subscribeProposalChanges(
  connection: Connection,
  onChange: () => void
): () => void {
  let active = true;
  let subscriptionId: number | null = null;
  try {
    const maybeId = connection.onProgramAccountChange(
      PROGRAM_ID,
      () => {
        if (active) onChange();
      },
      "confirmed"
    ) as number | Promise<number>;

    if (typeof maybeId === "number") {
      subscriptionId = maybeId;
    } else if (maybeId && typeof (maybeId as Promise<number>).then === "function") {
      maybeId
        .then((id) => {
          if (active) {
            subscriptionId = id;
          } else {
            connection.removeProgramAccountChangeListener(id).catch(() => undefined);
          }
        })
        .catch(() => undefined);
    }
  } catch {
    // Ignore websocket subscription errors; polling still keeps data updated.
  }

  return () => {
    active = false;
    if (subscriptionId !== null) {
      connection.removeProgramAccountChangeListener(subscriptionId).catch(() => undefined);
    }
  };
}
