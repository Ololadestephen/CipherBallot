#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::TokenAccount;
use arcium_anchor::prelude::{ArgBuilder, HasSize, SignedComputationOutputs, ARCIUM_PROG_ID};
use arcium_anchor::{CLUSTER_PDA_SEED, COMP_DEF_PDA_SEED, COMP_PDA_SEED, MXEEncryptedStruct, MXE_PDA_SEED};
use arcium_anchor::traits::{CallbackCompAccs, QueueCompAccs};
use arcium_client::idl::arcium::accounts::{Cluster, ComputationDefinitionAccount, MXEAccount};
use arcium_client::idl::arcium::cpi::accounts::{InitComputationDefinition, QueueComputation};
use arcium_client::idl::arcium::cpi::{init_computation_definition, queue_computation as queue_computation_cpi};
use arcium_client::idl::arcium::program::Arcium;
use arcium_client::idl::arcium::types::{CallbackAccount, CallbackInstruction, CircuitSource, ComputationDefinitionMeta, ComputationSignature, OffChainCircuitSource, Output, Parameter};
use arcium_macros::circuit_hash;

// Local deploy key requested for the production Arcium queue migration.
declare_id!("BkAZRNoDCQ6SKuyqMVTw3JYVT1TcEempjMRUQDC1oLE2");

const TITLE_MAX_LEN: usize = 128;
const OPTION_MAX_LEN: usize = 128;
const MAX_OPTIONS: usize = 8;
const MAX_WHITELIST: usize = 64;

const COMP_DEF_INIT_TALLY: u32 = 1_179_362_454;
const COMP_DEF_APPLY_VOTE: u32 = 3_401_005_569;
const COMP_DEF_REVEAL_TALLY: u32 = 1_651_770_906;

const INIT_TALLY_OUTPUT_SIZE: usize = 16 + (MAX_OPTIONS * 32);
const APPLY_VOTE_OUTPUT_SIZE: usize = 16 + (MAX_OPTIONS * 32);
const REVEAL_TALLY_OUTPUT_SIZE: usize = MAX_OPTIONS * 8;
const CALLBACK_OUTPUT_DELIVERY_FEE: u64 = 1_000_000;
const CIRCUIT_BASE_URL: &str = match option_env!("CIPHERBALLOT_CIRCUIT_BASE_URL") {
    Some(value) => value,
    None => "https://www.cipherballot.xyz/circuits",
};
const SIGNER_ACCOUNT_BUMP_OFFSET: usize = 8;

#[derive(Debug, AnchorSerialize, AnchorDeserialize)]
pub struct CallbackOutput<const N: usize>;

impl<const N: usize> HasSize for CallbackOutput<N> {
    const SIZE: usize = N;
}

#[program]
pub mod confidential_vote {
    use super::*;

    pub fn init_init_tally_comp_def(ctx: Context<InitComputationDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            COMP_DEF_INIT_TALLY,
            1_348_136,
            576_868_256,
            shared_params(8),
            mxe_outputs(8),
            Some(offchain_circuit_source("init_tally.arcis", circuit_hash!("init_tally"))),
        )
    }

    pub fn init_apply_vote_comp_def(ctx: Context<InitComputationDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            COMP_DEF_APPLY_VOTE,
            1_392_952,
            614_265_124,
            extend_params(shared_params(1), mxe_params(8)),
            mxe_outputs(8),
            Some(offchain_circuit_source("apply_vote.arcis", circuit_hash!("apply_vote"))),
        )
    }

    pub fn init_reveal_tally_comp_def(ctx: Context<InitComputationDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            COMP_DEF_REVEAL_TALLY,
            477_444,
            175_424_576,
            mxe_params(8),
            plaintext_u64_outputs(MAX_OPTIONS),
            Some(offchain_circuit_source("reveal_tally.arcis", circuit_hash!("reveal_tally"))),
        )
    }

    pub fn init_signer_account(ctx: Context<InitSignerAccount>) -> Result<()> {
        let (_, bump) = Pubkey::find_program_address(&[b"ArciumSignerAccount"], ctx.program_id);
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(9);
        let signer_seeds: &[&[u8]] = &[b"ArciumSignerAccount", &[bump]];

        system_program::create_account(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::CreateAccount {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.signer_account.to_account_info(),
                },
                &[signer_seeds],
            ),
            lamports,
            9,
            ctx.program_id,
        )?;

        ctx.accounts.signer_account.try_borrow_mut_data()?[8] = bump;
        Ok(())
    }

    pub fn create_proposal(
        ctx: Context<CreateProposal>,
        _proposal_salt: [u8; 8],
        title: [u8; TITLE_MAX_LEN],
        options: Vec<[u8; OPTION_MAX_LEN]>,
        start_time: i64,
        end_time: i64,
        eligibility_mode: u8,
        whitelist: Vec<Pubkey>,
    ) -> Result<()> {
        require!(options.len() >= 2, ErrorCode::InvalidOptions);
        require!(options.len() <= MAX_OPTIONS, ErrorCode::InvalidOptions);
        require!(whitelist.len() <= MAX_WHITELIST, ErrorCode::WhitelistTooLarge);
        require!(end_time > start_time, ErrorCode::InvalidVotingWindow);

        let proposal = &mut ctx.accounts.proposal;
        proposal.creator = ctx.accounts.creator.key();
        proposal.title = title;
        proposal.options = options;
        proposal.start_time = start_time;
        proposal.end_time = end_time;
        proposal.eligibility_mode = eligibility_mode;
        proposal.whitelist = whitelist;
        proposal.tally_initialized = false;
        proposal.finalized = false;
        proposal.reveal_requested = false;
        proposal.bump = ctx.bumps.proposal;
        proposal.results = Vec::new();
        proposal.vote_count = 0;
        proposal.mint = ctx.accounts.mint.key();
        proposal.version = 3;
        proposal.finalize_signature = Pubkey::default();
        proposal.last_apply_computation_offset = 0;
        proposal.last_reveal_computation_offset = 0;
        Ok(())
    }

    pub fn init_tally(
        ctx: Context<InitTally>,
        creator_x25519_pubkey: [u8; 32],
        nonce: u128,
        encrypted_tally: Vec<[u8; 32]>,
        computation_offset: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.proposal.tally_initialized, ErrorCode::AlreadyInitialized);
        require!(encrypted_tally.len() == MAX_OPTIONS, ErrorCode::InvalidEncryptedPayload);

        let proposal_key = ctx.accounts.proposal.key();
        let tally = &mut ctx.accounts.encrypted_tally;
        tally.proposal = proposal_key;
        tally.bump = ctx.bumps.encrypted_tally;
        tally.tally_nonce = nonce;
        tally.encrypted_tally = encrypted_tally.clone();
        tally.last_encrypted_vote = [0u8; 32];
        tally.applied_vote_count = 0;
        tally.pending_vote_count = 0;

        ctx.accounts.proposal.tally_initialized = true;

        let mut builder = ArgBuilder::new()
            .x25519_pubkey(creator_x25519_pubkey)
            .plaintext_u128(nonce);
        for word in encrypted_tally {
            builder = builder.encrypted_u64(word);
        }

        queue_computation_with_callback_fee(
            &ctx.accounts,
            computation_offset,
            builder.build(),
            vec![InitTallyCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[
                    callback_extra_account(ctx.accounts.proposal.key(), true),
                    callback_extra_account(ctx.accounts.encrypted_tally.key(), true),
                ],
            )?],
            1,
            0,
        )?;

        emit!(InitTallyQueued { proposal: proposal_key, computation_offset });
        Ok(())
    }

    pub fn cast_vote(
        ctx: Context<CastVote>,
        voter_x25519_pubkey: [u8; 32],
        nonce: u128,
        encrypted_vote: [u8; 32],
        computation_offset: u64,
    ) -> Result<()> {
        let clock = Clock::get()?;
        require!(encrypted_vote != [0u8; 32], ErrorCode::InvalidEncryptedPayload);

        let proposal_key = ctx.accounts.proposal.key();
        let encrypted_tally_key = ctx.accounts.encrypted_tally.key();
        let voter_record_key = ctx.accounts.voter_record.key();

        let (tally_nonce, encrypted_tally_words) = {
            let proposal = &mut ctx.accounts.proposal;
            require!(proposal.tally_initialized, ErrorCode::TallyNotInitialized);
            require!(clock.unix_timestamp >= proposal.start_time, ErrorCode::VotingNotStarted);
            require!(clock.unix_timestamp <= proposal.end_time, ErrorCode::VotingEnded);
            require!(!proposal.finalized, ErrorCode::AlreadyFinalized);

            enforce_eligibility(proposal, &ctx.accounts.voter, ctx.accounts.voter_token.as_ref())?;

            proposal.vote_count = proposal.vote_count.checked_add(1).ok_or(ErrorCode::MathOverflow)?;
            proposal.last_apply_computation_offset = computation_offset;

            let tally = &mut ctx.accounts.encrypted_tally;
            require!(tally.proposal == proposal_key, ErrorCode::InvalidTallyAccount);
            tally.last_encrypted_vote = encrypted_vote;
            tally.pending_vote_count = tally.pending_vote_count.checked_add(1).ok_or(ErrorCode::MathOverflow)?;

            (tally.tally_nonce, tally.encrypted_tally.clone())
        };

        let mut builder = ArgBuilder::new()
            .x25519_pubkey(voter_x25519_pubkey)
            .plaintext_u128(nonce)
            .encrypted_u8(encrypted_vote)
            .plaintext_u128(tally_nonce);
        for word in encrypted_tally_words {
            builder = builder.encrypted_u64(word);
        }

        queue_computation_with_callback_fee(
            &ctx.accounts,
            computation_offset,
            builder.build(),
            vec![ApplyVoteCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[
                    callback_extra_account(proposal_key, true),
                    callback_extra_account(encrypted_tally_key, true),
                ],
            )?],
            1,
            0,
        )?;

        emit!(EncryptedVoteQueued {
            proposal: proposal_key,
            voter_record: voter_record_key,
            computation_offset,
        });
        Ok(())
    }

    pub fn finalize_tally(ctx: Context<FinalizeTally>, computation_offset: u64) -> Result<()> {
        let clock = Clock::get()?;
        let proposal_key = ctx.accounts.proposal.key();

        let (tally_nonce, encrypted_tally_words) = {
            let proposal = &mut ctx.accounts.proposal;
            require!(clock.unix_timestamp > proposal.end_time, ErrorCode::VotingNotEnded);
            require!(!proposal.finalized, ErrorCode::AlreadyFinalized);
            require!(proposal.tally_initialized, ErrorCode::TallyNotInitialized);
            require!(ctx.accounts.encrypted_tally.pending_vote_count == 0, ErrorCode::PendingVotes);

            proposal.reveal_requested = true;
            proposal.last_reveal_computation_offset = computation_offset;

            (
                ctx.accounts.encrypted_tally.tally_nonce,
                ctx.accounts.encrypted_tally.encrypted_tally.clone(),
            )
        };

        let mut builder = ArgBuilder::new().plaintext_u128(tally_nonce);
        for word in encrypted_tally_words {
            builder = builder.encrypted_u64(word);
        }

        queue_computation_with_callback_fee(
            &ctx.accounts,
            computation_offset,
            builder.build(),
            vec![RevealTallyCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[callback_extra_account(proposal_key, true)],
            )?],
            1,
            0,
        )?;

        emit!(RevealQueued { proposal: proposal_key, computation_offset });
        Ok(())
    }

    #[arcium_macros::arcium_callback(encrypted_ix = "init_tally", auto_serialize = false)]
    pub fn init_tally_callback(
        ctx: Context<InitTallyCallback>,
        output: SignedComputationOutputs<CallbackOutput<INIT_TALLY_OUTPUT_SIZE>>,
    ) -> Result<()> {
        let raw = output.verify_output_raw(&ctx.accounts.cluster_account, &ctx.accounts.computation_account)?;
        let (nonce, encrypted_tally) = parse_encrypted_tally_output(&raw)?;
        let proposal = &mut ctx.accounts.proposal;
        let tally = &mut ctx.accounts.encrypted_tally;
        require!(tally.proposal == proposal.key(), ErrorCode::InvalidTallyAccount);
        proposal.tally_initialized = true;
        tally.tally_nonce = nonce;
        tally.encrypted_tally = encrypted_tally;
        Ok(())
    }

    #[arcium_macros::arcium_callback(encrypted_ix = "apply_vote", auto_serialize = false)]
    pub fn apply_vote_callback(
        ctx: Context<ApplyVoteCallback>,
        output: SignedComputationOutputs<CallbackOutput<APPLY_VOTE_OUTPUT_SIZE>>,
    ) -> Result<()> {
        let raw = output.verify_output_raw(&ctx.accounts.cluster_account, &ctx.accounts.computation_account)?;
        let (nonce, encrypted_tally) = parse_encrypted_tally_output(&raw)?;
        let proposal = &ctx.accounts.proposal;
        let tally = &mut ctx.accounts.encrypted_tally;
        require!(tally.proposal == proposal.key(), ErrorCode::InvalidTallyAccount);
        require!(!proposal.finalized, ErrorCode::AlreadyFinalized);
        tally.tally_nonce = nonce;
        tally.encrypted_tally = encrypted_tally;
        tally.applied_vote_count = tally.applied_vote_count.checked_add(1).ok_or(ErrorCode::MathOverflow)?;
        tally.pending_vote_count = tally.pending_vote_count.saturating_sub(1);
        emit!(ApplyVoteResolved {
            proposal: proposal.key(),
            applied_vote_count: tally.applied_vote_count,
        });
        Ok(())
    }

    #[arcium_macros::arcium_callback(encrypted_ix = "reveal_tally", auto_serialize = false)]
    pub fn reveal_tally_callback(
        ctx: Context<RevealTallyCallback>,
        output: SignedComputationOutputs<CallbackOutput<REVEAL_TALLY_OUTPUT_SIZE>>,
    ) -> Result<()> {
        let raw = output.verify_output_raw(&ctx.accounts.cluster_account, &ctx.accounts.computation_account)?;
        let results = parse_reveal_output(&raw, ctx.accounts.proposal.options.len())?;
        let proposal = &mut ctx.accounts.proposal;
        require!(proposal.reveal_requested, ErrorCode::RevealNotRequested);
        require!(!proposal.finalized, ErrorCode::AlreadyFinalized);
        proposal.results = results;
        proposal.finalized = true;
        proposal.finalize_signature = ctx.accounts.computation_account.key();
        emit!(TallyRevealed { proposal: proposal.key() });
        Ok(())
    }
}

fn enforce_eligibility(
    proposal: &Proposal,
    voter: &Signer,
    voter_token: Option<&Account<TokenAccount>>,
) -> Result<()> {
    if proposal.eligibility_mode == 1 {
        require!(proposal.whitelist.iter().any(|key| *key == voter.key()), ErrorCode::NotWhitelisted);
    }

    if proposal.eligibility_mode == 2 {
        let token_account = voter_token.ok_or(ErrorCode::TokenAccountRequired)?;
        require!(token_account.mint == proposal.mint, ErrorCode::InvalidMint);
        require!(token_account.owner == voter.key(), ErrorCode::InvalidTokenOwner);
        require!(token_account.amount > 0, ErrorCode::InsufficientTokens);
    }
    Ok(())
}

fn parse_encrypted_tally_output(raw: &[u8]) -> Result<(u128, Vec<[u8; 32]>)> {
    require!(raw.len() >= INIT_TALLY_OUTPUT_SIZE, ErrorCode::InvalidCallbackOutput);
    let mut nonce_bytes = [0u8; 16];
    nonce_bytes.copy_from_slice(&raw[0..16]);
    let nonce = u128::from_le_bytes(nonce_bytes);
    let mut tally = Vec::with_capacity(MAX_OPTIONS);
    for i in 0..MAX_OPTIONS {
        let start = 16 + (i * 32);
        let mut word = [0u8; 32];
        word.copy_from_slice(&raw[start..start + 32]);
        tally.push(word);
    }
    Ok((nonce, tally))
}

fn parse_reveal_output(raw: &[u8], option_count: usize) -> Result<Vec<u64>> {
    require!(raw.len() >= REVEAL_TALLY_OUTPUT_SIZE, ErrorCode::InvalidCallbackOutput);
    require!(option_count <= MAX_OPTIONS, ErrorCode::InvalidOptions);
    let mut results = Vec::with_capacity(option_count);
    for i in 0..option_count {
        let start = i * 8;
        let mut bytes = [0u8; 8];
        bytes.copy_from_slice(&raw[start..start + 8]);
        results.push(u64::from_le_bytes(bytes));
    }
    Ok(results)
}

fn shared_params(ciphertexts: usize) -> Vec<Parameter> {
    let mut params = Vec::with_capacity(ciphertexts + 2);
    params.push(Parameter::ArcisX25519Pubkey);
    params.push(Parameter::PlaintextU128);
    params.extend(core::iter::repeat(Parameter::Ciphertext).take(ciphertexts));
    params
}

fn mxe_params(ciphertexts: usize) -> Vec<Parameter> {
    let mut params = Vec::with_capacity(ciphertexts + 1);
    params.push(Parameter::PlaintextU128);
    params.extend(core::iter::repeat(Parameter::Ciphertext).take(ciphertexts));
    params
}

fn extend_params(mut params: Vec<Parameter>, next: Vec<Parameter>) -> Vec<Parameter> {
    params.extend(next);
    params
}

fn mxe_outputs(ciphertexts: usize) -> Vec<Output> {
    let mut outputs = Vec::with_capacity(ciphertexts + 1);
    outputs.push(Output::PlaintextU128);
    outputs.extend(core::iter::repeat(Output::Ciphertext).take(ciphertexts));
    outputs
}

fn plaintext_u64_outputs(count: usize) -> Vec<Output> {
    core::iter::repeat(Output::PlaintextU64).take(count).collect()
}

fn offchain_circuit_source(file_name: &str, hash: [u8; 32]) -> CircuitSource {
    let mut source = CIRCUIT_BASE_URL.trim_end_matches('/').to_string();
    source.push('/');
    source.push_str(file_name);

    CircuitSource::OffChain(OffChainCircuitSource { source, hash })
}

fn init_comp_def(
    accs: &mut InitComputationDef,
    comp_def_offset: u32,
    compiled_circuit_len: u32,
    weight: u64,
    parameters: Vec<Parameter>,
    outputs: Vec<Output>,
    circuit_source: Option<CircuitSource>,
) -> Result<()> {
    let cpi_accounts = InitComputationDefinition {
        signer: accs.payer.to_account_info(),
        system_program: accs.system_program.to_account_info(),
        comp_def_acc: accs.comp_def_acc.to_account_info(),
        mxe: accs.mxe_account.to_account_info(),
        address_lookup_table: accs.address_lookup_table.to_account_info(),
        lut_program: accs.lut_program.to_account_info(),
    };
    let cpi_context = CpiContext::new(accs.arcium_program.to_account_info(), cpi_accounts);
    let computation_definition = ComputationDefinitionMeta {
        circuit_len: compiled_circuit_len,
        signature: ComputationSignature { parameters, outputs },
    };

    init_computation_definition(
        cpi_context,
        comp_def_offset,
        crate::ID,
        computation_definition,
        circuit_source,
        weight,
        None,
    )
}

fn validate_callback_ixs(instructions_sysvar: &AccountInfo, arcium_program: &Pubkey) -> Result<()> {
    const ARCIUM_CALLBACK_COMPUTATION_DISCRIMINATOR: [u8; 8] = [11, 224, 42, 236, 0, 154, 74, 163];
    const LIGHTHOUSE_PROGRAM_ID: Pubkey = pubkey!("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95");

    let curr_ix_index =
        anchor_lang::solana_program::sysvar::instructions::load_current_index_checked(
            instructions_sysvar,
        )?;
    require!(curr_ix_index != 0, ErrorCode::InvalidCallbackSignature);

    let prev_ix = anchor_lang::solana_program::sysvar::instructions::load_instruction_at_checked(
        (curr_ix_index as usize) - 1,
        instructions_sysvar,
    )?;
    require_keys_eq!(prev_ix.program_id, *arcium_program, ErrorCode::InvalidCallbackSignature);
    require!(
        prev_ix.data.len() >= 8
            && prev_ix.data[0..8] == ARCIUM_CALLBACK_COMPUTATION_DISCRIMINATOR,
        ErrorCode::InvalidCallbackSignature
    );

    let mut check_index = (curr_ix_index as usize) + 1;
    let mut lighthouse_count = 0usize;
    while let Ok(ix) =
        anchor_lang::solana_program::sysvar::instructions::load_instruction_at_checked(
            check_index,
            instructions_sysvar,
        )
    {
        require_keys_eq!(ix.program_id, LIGHTHOUSE_PROGRAM_ID, ErrorCode::InvalidCallbackSignature);
        lighthouse_count += 1;
        require!(lighthouse_count <= 2, ErrorCode::InvalidCallbackSignature);
        check_index += 1;
    }

    Ok(())
}

fn callback_extra_account(pubkey: Pubkey, is_writable: bool) -> CallbackAccount {
    CallbackAccount { pubkey, is_writable }
}

macro_rules! impl_queue_comp_accs {
    ($struct_name:ident, $offset_const:expr, $payer_field:ident) => {
        impl<'info> QueueCompAccs<'info> for $struct_name<'info> {
            fn comp_def_offset(&self) -> u32 { $offset_const }
            fn queue_comp_accs(&self) -> QueueComputation<'info> {
                QueueComputation {
                    signer: self.$payer_field.to_account_info(),
                    sign_seed: self.signer_account.to_account_info(),
                    cluster: self.cluster.to_account_info(),
                    mxe: self.mxe_account.to_account_info(),
                    mempool: self.mempool_account.to_account_info(),
                    executing_pool: self.execpool_account.to_account_info(),
                    comp_def_acc: self.comp_def_account.to_account_info(),
                    pool_account: self.pool_account.to_account_info(),
                    system_program: self.system_program.to_account_info(),
                    clock: self.clock_account.to_account_info(),
                    comp: self.comp_account.to_account_info(),
                }
            }
            fn arcium_program(&self) -> AccountInfo<'info> { self.arcium_program.to_account_info() }
            fn mxe_program(&self) -> Pubkey { crate::ID }
            fn signer_pda_bump(&self) -> u8 {
                let (_, bump) = Pubkey::find_program_address(&[b"ArciumSignerAccount"], &crate::ID);
                bump
            }
        }

        impl<'info, 'a> QueueCompAccs<'info> for &'a $struct_name<'info> {
            fn comp_def_offset(&self) -> u32 { (**self).comp_def_offset() }
            fn queue_comp_accs(&self) -> QueueComputation<'info> { (**self).queue_comp_accs() }
            fn arcium_program(&self) -> AccountInfo<'info> { (**self).arcium_program() }
            fn mxe_program(&self) -> Pubkey { (**self).mxe_program() }
            fn signer_pda_bump(&self) -> u8 { (**self).signer_pda_bump() }
        }

        impl<'info, 'a> QueueCompAccs<'info> for &'a mut $struct_name<'info> {
            fn comp_def_offset(&self) -> u32 { (**self).comp_def_offset() }
            fn queue_comp_accs(&self) -> QueueComputation<'info> { (**self).queue_comp_accs() }
            fn arcium_program(&self) -> AccountInfo<'info> { (**self).arcium_program() }
            fn mxe_program(&self) -> Pubkey { (**self).mxe_program() }
            fn signer_pda_bump(&self) -> u8 { (**self).signer_pda_bump() }
        }
    };
}

#[derive(Accounts)]
pub struct InitComputationDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub arcium_program: Program<'info, Arcium>,
    #[account(mut)]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: Arcium computation definition PDA derived from the circuit name offset.
    #[account(mut)]
    pub comp_def_acc: UncheckedAccount<'info>,
    /// CHECK: MXE address lookup table account used by Arcium computation definitions.
    #[account(mut)]
    pub address_lookup_table: UncheckedAccount<'info>,
    /// CHECK: Solana Address Lookup Table program.
    pub lut_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitSignerAccount<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Program-owned signer PDA for Arcium.
    /// CHECK: Program-owned Arcium signer PDA constrained by seeds and bump.
    #[account(mut, seeds = [b"ArciumSignerAccount"], bump)]
    pub signer_account: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(proposal_salt: [u8; 8])]
pub struct CreateProposal<'info> {
    #[account(
        init,
        payer = creator,
        space = Proposal::LEN,
        seeds = [b"proposal", creator.key().as_ref(), proposal_salt.as_ref()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,
    #[account(mut)]
    pub creator: Signer<'info>,
    /// CHECK: Optional mint for token gating.
    pub mint: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitTally<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut, has_one = creator)]
    pub proposal: Account<'info, Proposal>,
    #[account(init, payer = creator, space = EncryptedTally::LEN, seeds = [b"encrypted_tally", proposal.key().as_ref()], bump)]
    pub encrypted_tally: Account<'info, EncryptedTally>,

    pub arcium_program: Program<'info, Arcium>,
    #[account(mut)]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: Arcium cluster PDA derived by the client and verified by the Arcium CPI.
    #[account(mut)]
    pub cluster: UncheckedAccount<'info>,
    /// CHECK: Arcium computation definition PDA for the selected encrypted circuit.
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,
    /// CHECK: Arcium mempool account used by queue_computation CPI.
    #[account(mut)]
    pub mempool_account: UncheckedAccount<'info>,
    /// CHECK: Arcium executing pool account used by queue_computation CPI.
    #[account(mut)]
    pub execpool_account: UncheckedAccount<'info>,
    /// CHECK: Arcium fee pool account used by queue_computation CPI.
    #[account(mut)]
    pub pool_account: UncheckedAccount<'info>,
    /// CHECK: Arcium clock PDA used by queue_computation CPI.
    #[account(mut)]
    pub clock_account: UncheckedAccount<'info>,
    /// CHECK: Program-owned Arcium signer PDA constrained by seeds and bump.
    #[account(mut, seeds = [b"ArciumSignerAccount"], bump)]
    pub signer_account: UncheckedAccount<'info>,
    /// CHECK: Arcium computation PDA derived from cluster offset and computation offset.
    #[account(mut)]
    pub comp_account: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
impl_queue_comp_accs!(InitTally, COMP_DEF_INIT_TALLY, creator);

#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    #[account(mut, seeds = [b"encrypted_tally", proposal.key().as_ref()], bump = encrypted_tally.bump)]
    pub encrypted_tally: Account<'info, EncryptedTally>,
    #[account(init, payer = voter, space = VoterRecord::LEN, seeds = [b"voter", voter.key().as_ref(), proposal.key().as_ref()], bump)]
    pub voter_record: Account<'info, VoterRecord>,
    #[account(token::mint = proposal.mint, token::authority = voter)]
    pub voter_token: Option<Account<'info, TokenAccount>>,

    pub arcium_program: Program<'info, Arcium>,
    #[account(mut)]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: Arcium cluster PDA derived by the client and verified by the Arcium CPI.
    #[account(mut)]
    pub cluster: UncheckedAccount<'info>,
    /// CHECK: Arcium computation definition PDA for the selected encrypted circuit.
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,
    /// CHECK: Arcium mempool account used by queue_computation CPI.
    #[account(mut)]
    pub mempool_account: UncheckedAccount<'info>,
    /// CHECK: Arcium executing pool account used by queue_computation CPI.
    #[account(mut)]
    pub execpool_account: UncheckedAccount<'info>,
    /// CHECK: Arcium fee pool account used by queue_computation CPI.
    #[account(mut)]
    pub pool_account: UncheckedAccount<'info>,
    /// CHECK: Arcium clock PDA used by queue_computation CPI.
    #[account(mut)]
    pub clock_account: UncheckedAccount<'info>,
    /// CHECK: Program-owned Arcium signer PDA constrained by seeds and bump.
    #[account(mut, seeds = [b"ArciumSignerAccount"], bump)]
    pub signer_account: UncheckedAccount<'info>,
    /// CHECK: Arcium computation PDA derived from cluster offset and computation offset.
    #[account(mut)]
    pub comp_account: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
impl_queue_comp_accs!(CastVote, COMP_DEF_APPLY_VOTE, voter);

#[derive(Accounts)]
pub struct FinalizeTally<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut, has_one = creator)]
    pub proposal: Account<'info, Proposal>,
    #[account(seeds = [b"encrypted_tally", proposal.key().as_ref()], bump = encrypted_tally.bump)]
    pub encrypted_tally: Account<'info, EncryptedTally>,

    pub arcium_program: Program<'info, Arcium>,
    #[account(mut)]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: Arcium cluster PDA derived by the client and verified by the Arcium CPI.
    #[account(mut)]
    pub cluster: UncheckedAccount<'info>,
    /// CHECK: Arcium computation definition PDA for the selected encrypted circuit.
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,
    /// CHECK: Arcium mempool account used by queue_computation CPI.
    #[account(mut)]
    pub mempool_account: UncheckedAccount<'info>,
    /// CHECK: Arcium executing pool account used by queue_computation CPI.
    #[account(mut)]
    pub execpool_account: UncheckedAccount<'info>,
    /// CHECK: Arcium fee pool account used by queue_computation CPI.
    #[account(mut)]
    pub pool_account: UncheckedAccount<'info>,
    /// CHECK: Arcium clock PDA used by queue_computation CPI.
    #[account(mut)]
    pub clock_account: UncheckedAccount<'info>,
    /// CHECK: Program-owned Arcium signer PDA constrained by seeds and bump.
    #[account(mut, seeds = [b"ArciumSignerAccount"], bump)]
    pub signer_account: UncheckedAccount<'info>,
    /// CHECK: Arcium computation PDA derived from cluster offset and computation offset.
    #[account(mut)]
    pub comp_account: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
impl_queue_comp_accs!(FinalizeTally, COMP_DEF_REVEAL_TALLY, creator);

#[cfg_attr(not(feature = "idl-build"), arcium_macros::callback_accounts("init_tally"))]
#[derive(Accounts)]
pub struct InitTallyCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: Verified by SignedComputationOutputs.
    pub computation_account: UncheckedAccount<'info>,
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions sysvar.
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    #[account(mut, seeds = [b"encrypted_tally", proposal.key().as_ref()], bump = encrypted_tally.bump)]
    pub encrypted_tally: Account<'info, EncryptedTally>,
}

#[cfg_attr(not(feature = "idl-build"), arcium_macros::callback_accounts("apply_vote"))]
#[derive(Accounts)]
pub struct ApplyVoteCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: Verified by SignedComputationOutputs.
    pub computation_account: UncheckedAccount<'info>,
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions sysvar.
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    #[account(mut, seeds = [b"encrypted_tally", proposal.key().as_ref()], bump = encrypted_tally.bump)]
    pub encrypted_tally: Account<'info, EncryptedTally>,
}

#[cfg_attr(not(feature = "idl-build"), arcium_macros::callback_accounts("reveal_tally"))]
#[derive(Accounts)]
pub struct RevealTallyCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: Verified by SignedComputationOutputs.
    pub computation_account: UncheckedAccount<'info>,
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions sysvar.
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
}

impl anchor_lang::Discriminator for InitTallyCallback<'_> {
    const DISCRIMINATOR: &'static [u8] = &[156, 66, 122, 80, 120, 31, 153, 189];
}
impl anchor_lang::Discriminator for ApplyVoteCallback<'_> {
    const DISCRIMINATOR: &'static [u8] = &[208, 103, 112, 26, 46, 162, 221, 42];
}
fn queue_computation_with_callback_fee<'info, T>(
    accs: &T,
    computation_offset: u64,
    args: arcium_client::idl::arcium::types::ArgumentList,
    callback_instructions: Vec<CallbackInstruction>,
    num_callback_txs: u8,
    cu_price_micro: u64,
) -> Result<()>
where
    T: QueueCompAccs<'info>,
{
    let bump = accs.signer_pda_bump();
    let signer_seeds: &[&[&[u8]]] = &[&[arcium_anchor::SIGN_PDA_SEED, &[bump]]];
    let queue_comp_accounts = accs.queue_comp_accs();
    queue_comp_accounts.sign_seed.try_borrow_mut_data()?[SIGNER_ACCOUNT_BUMP_OFFSET] = bump;

    let cpi_context = CpiContext::new_with_signer(accs.arcium_program(), queue_comp_accounts, signer_seeds);
    queue_computation_cpi(
        cpi_context,
        computation_offset,
        accs.comp_def_offset(),
        args,
        accs.mxe_program(),
        callback_instructions,
        num_callback_txs,
        CALLBACK_OUTPUT_DELIVERY_FEE,
        cu_price_micro,
    )
}

impl anchor_lang::Discriminator for RevealTallyCallback<'_> {
    const DISCRIMINATOR: &'static [u8] = &[240, 82, 186, 92, 49, 162, 244, 65];
}

#[cfg(feature = "idl-build")]
macro_rules! impl_callback_comp_accs_for_idl {
    ($struct_name:ident, $encrypted_ix:expr, $discriminator:expr) => {
        impl CallbackCompAccs for $struct_name<'_> {
            fn callback_ix(
                computation_offset: u64,
                mxe_account: &MXEAccount,
                extra_accs: &[CallbackAccount],
            ) -> Result<CallbackInstruction> {
                let mut accounts = Vec::with_capacity(extra_accs.len() + 6);
                accounts.push(CallbackAccount { pubkey: ARCIUM_PROG_ID, is_writable: false });
                accounts.push(CallbackAccount { pubkey: arcium_anchor::derive_comp_def_pda!(arcium_anchor::comp_def_offset($encrypted_ix)), is_writable: false });
                accounts.push(CallbackAccount { pubkey: arcium_anchor::derive_mxe_pda!(), is_writable: false });
                accounts.push(CallbackAccount { pubkey: arcium_anchor::derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet), is_writable: false });
                accounts.push(CallbackAccount { pubkey: arcium_anchor::derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet), is_writable: false });
                accounts.push(CallbackAccount { pubkey: anchor_lang::solana_program::sysvar::instructions::ID, is_writable: false });
                accounts.extend_from_slice(extra_accs);
                Ok(CallbackInstruction { program_id: crate::ID_CONST, discriminator: $discriminator.to_vec(), accounts })
            }
        }
    };
}

#[cfg(feature = "idl-build")]
impl_callback_comp_accs_for_idl!(InitTallyCallback, "init_tally", &[156, 66, 122, 80, 120, 31, 153, 189]);
#[cfg(feature = "idl-build")]
impl_callback_comp_accs_for_idl!(ApplyVoteCallback, "apply_vote", &[208, 103, 112, 26, 46, 162, 221, 42]);
#[cfg(feature = "idl-build")]
impl_callback_comp_accs_for_idl!(RevealTallyCallback, "reveal_tally", &[240, 82, 186, 92, 49, 162, 244, 65]);

#[account]
pub struct Proposal {
    pub creator: Pubkey,
    pub title: [u8; TITLE_MAX_LEN],
    pub options: Vec<[u8; OPTION_MAX_LEN]>,
    pub start_time: i64,
    pub end_time: i64,
    pub eligibility_mode: u8,
    pub tally_initialized: bool,
    pub finalized: bool,
    pub reveal_requested: bool,
    pub finalize_signature: Pubkey,
    pub results: Vec<u64>,
    pub bump: u8,
    pub mint: Pubkey,
    pub whitelist: Vec<Pubkey>,
    pub version: u8,
    pub vote_count: u64,
    pub last_apply_computation_offset: u64,
    pub last_reveal_computation_offset: u64,
}
impl Proposal {
    pub const LEN: usize = 8 + 32 + TITLE_MAX_LEN + 4 + (MAX_OPTIONS * OPTION_MAX_LEN) + 8 + 8 + 1 + 1 + 1 + 1 + 32 + 4 + (8 * MAX_OPTIONS) + 1 + 32 + 4 + (MAX_WHITELIST * 32) + 1 + 8 + 8 + 8;
}

#[account]
pub struct EncryptedTally {
    pub proposal: Pubkey,
    pub tally_nonce: u128,
    pub encrypted_tally: Vec<[u8; 32]>,
    pub last_encrypted_vote: [u8; 32],
    pub applied_vote_count: u64,
    pub pending_vote_count: u64,
    pub bump: u8,
}
impl EncryptedTally {
    pub const LEN: usize = 8 + 32 + 16 + 4 + (MAX_OPTIONS * 32) + 32 + 8 + 8 + 1;
}

#[account]
pub struct VoterRecord {}
impl VoterRecord { pub const LEN: usize = 8; }

#[event]
pub struct InitTallyQueued { pub proposal: Pubkey, pub computation_offset: u64 }
#[event]
pub struct EncryptedVoteQueued { pub proposal: Pubkey, pub voter_record: Pubkey, pub computation_offset: u64 }
#[event]
pub struct ApplyVoteResolved { pub proposal: Pubkey, pub applied_vote_count: u64 }
#[event]
pub struct RevealQueued { pub proposal: Pubkey, pub computation_offset: u64 }
#[event]
pub struct TallyRevealed { pub proposal: Pubkey }

#[error_code]
pub enum ErrorCode {
    #[msg("Already initialized")]
    AlreadyInitialized,
    #[msg("Tally not initialized")]
    TallyNotInitialized,
    #[msg("Voting has not started")]
    VotingNotStarted,
    #[msg("Voting has ended")]
    VotingEnded,
    #[msg("Voting has not ended yet")]
    VotingNotEnded,
    #[msg("Already finalized")]
    AlreadyFinalized,
    #[msg("Invalid results length")]
    InvalidResults,
    #[msg("Voter is not whitelisted")]
    NotWhitelisted,
    #[msg("Token account required for this proposal")]
    TokenAccountRequired,
    #[msg("Token mint does not match proposal")]
    InvalidMint,
    #[msg("Token account owner mismatch")]
    InvalidTokenOwner,
    #[msg("Insufficient token balance")]
    InsufficientTokens,
    #[msg("Invalid proposal options")]
    InvalidOptions,
    #[msg("Whitelist is too large")]
    WhitelistTooLarge,
    #[msg("Invalid voting window")]
    InvalidVotingWindow,
    #[msg("Invalid encrypted payload")]
    InvalidEncryptedPayload,
    #[msg("Invalid encrypted tally account")]
    InvalidTallyAccount,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Encrypted votes are still waiting for Arcium application")]
    PendingVotes,
    #[msg("Reveal computation has not been requested")]
    RevealNotRequested,
    #[msg("Invalid callback output")]
    InvalidCallbackOutput,
    #[msg("Invalid callback signature")]
    InvalidCallbackSignature,
    #[msg("Arcium computation failed")]
    ComputationFailed,
    #[msg("Arcium cluster is not set")]
    ClusterNotSet,
}
