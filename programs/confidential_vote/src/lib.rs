use anchor_lang::prelude::*;
use anchor_spl::token::{TokenAccount, Token};
use solana_program::instruction::{Instruction, AccountMeta};
use solana_program::program::invoke;

declare_id!("Bc7u1THDttJMjzbdhestYiXPqq8XxCJMpfeDzU54h66L");

const TITLE_MAX_LEN: usize = 128;
const OPTION_MAX_LEN: usize = 128;
const MAX_OPTIONS: usize = 8;
const MAX_WHITELIST: usize = 64;

#[program]
pub mod confidential_vote {
    use super::*;

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
        let proposal = &mut ctx.accounts.proposal;
        proposal.creator = ctx.accounts.creator.key();
        proposal.title = title;
        proposal.options = options.clone();
        proposal.start_time = start_time;
        proposal.end_time = end_time;
        proposal.eligibility_mode = eligibility_mode;
        proposal.whitelist = whitelist;
        proposal.tally_initialized = false;
        proposal.finalized = false;
        proposal.bump = ctx.bumps.proposal;
        proposal.results = vec![0; options.len()];
        proposal.vote_count = 0;
        proposal.mint = ctx.accounts.mint.key(); 

        Ok(())
    }

    // ... init_tally remains same ...

    pub fn init_tally(
        ctx: Context<InitTally>,
        _creator_x25519_pubkey: [u8; 32],
        _nonce: u128,
        _encrypted_tally: Vec<[u8; 32]>,
    ) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        require!(!proposal.tally_initialized, ErrorCode::AlreadyInitialized);
        
        proposal.tally_initialized = true;
        Ok(())
    }

    pub fn cast_vote(
        ctx: Context<CastVote>,
        _voter_x25519_pubkey: [u8; 32],
        _nonce: u128,
        encrypted_vote: [u8; 32],
        vote_index: u8,
    ) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        let clock = Clock::get()?;
        
        require!(proposal.tally_initialized, ErrorCode::TallyNotInitialized);
        require!(clock.unix_timestamp >= proposal.start_time, ErrorCode::VotingNotStarted);
        require!(clock.unix_timestamp <= proposal.end_time, ErrorCode::VotingEnded);
        require!(!proposal.finalized, ErrorCode::AlreadyFinalized);

        // Eligibility Checks
        // Mode 1: Whitelist
        if proposal.eligibility_mode == 1 {
            let voter_key = ctx.accounts.voter.key();
            let mut is_whitelisted = false;
            for key in &proposal.whitelist {
                if *key == voter_key {
                    is_whitelisted = true;
                    break;
                }
            }
            require!(is_whitelisted, ErrorCode::NotWhitelisted);
        }

        // Mode 2: Token Gated
        if proposal.eligibility_mode == 2 {
            let token_account = ctx.accounts.voter_token.as_ref().ok_or(ErrorCode::TokenAccountRequired)?;
            require!(token_account.mint == proposal.mint, ErrorCode::InvalidMint);
            require!(token_account.owner == ctx.accounts.voter.key(), ErrorCode::InvalidTokenOwner);
            require!(token_account.amount > 0, ErrorCode::InsufficientTokens);
        }

        // Increment total vote count
        proposal.vote_count += 1;

        // Increment specific option count (Hybrid/Demo: Public Counting)
        if (vote_index as usize) < proposal.results.len() {
             proposal.results[vote_index as usize] += 1;
        }

        
        let tally = &mut ctx.accounts.encrypted_tally;
        tally.last_encrypted_vote = encrypted_vote;
        
        Ok(())
    }

    pub fn finalize_tally(
        ctx: Context<FinalizeTally>
    ) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        let clock = Clock::get()?;
        
        require!(clock.unix_timestamp > proposal.end_time, ErrorCode::VotingNotEnded);
        require!(!proposal.finalized, ErrorCode::AlreadyFinalized);

        proposal.finalized = true;
        // Results are already accumulated in proposal.results via cast_vote
        Ok(())
    }


    pub fn init_init_tally_comp_def(ctx: Context<InitCompDef>) -> Result<()> {
        msg!("Initializing Tally Comp Def via CPI");
        
        let signature = ComputationSignature {
            parameters: vec![
                Parameter::ArcisX25519Pubkey,
                Parameter::PlaintextU128,
                Parameter::Ciphertext, Parameter::Ciphertext, Parameter::Ciphertext, Parameter::Ciphertext,
                Parameter::Ciphertext, Parameter::Ciphertext, Parameter::Ciphertext, Parameter::Ciphertext,
            ],
            outputs: vec![
                Output::PlaintextU128,
                Output::Ciphertext, Output::Ciphertext, Output::Ciphertext, Output::Ciphertext,
                Output::Ciphertext, Output::Ciphertext, Output::Ciphertext, Output::Ciphertext,
            ],
        };
        
        let meta = ComputationDefinitionMeta {
            circuit_len: 1348136, 
            signature,
        };

        let offset = get_noop_offset("init_tally"); 

        init_computation_definition(ctx, offset, meta)
    }

    pub fn init_apply_vote_comp_def(ctx: Context<InitCompDef>) -> Result<()> {
        msg!("Initializing Apply Vote Comp Def");
        
        let signature = ComputationSignature {
            parameters: vec![
                Parameter::ArcisX25519Pubkey,
                Parameter::PlaintextU128,
                Parameter::Ciphertext, // Vote
                Parameter::PlaintextU128, // Tally Nonce
                Parameter::Ciphertext, Parameter::Ciphertext, Parameter::Ciphertext, Parameter::Ciphertext,
                Parameter::Ciphertext, Parameter::Ciphertext, Parameter::Ciphertext, Parameter::Ciphertext,
            ],
            outputs: vec![
                Output::PlaintextU128,
                Output::Ciphertext, Output::Ciphertext, Output::Ciphertext, Output::Ciphertext,
                Output::Ciphertext, Output::Ciphertext, Output::Ciphertext, Output::Ciphertext,
            ],
        };
        
        let meta = ComputationDefinitionMeta {
            circuit_len: 1392952,
            signature,
        };
        
        let offset = get_noop_offset("apply_vote");
        init_computation_definition(ctx, offset, meta)
    }

    pub fn init_reveal_tally_comp_def(ctx: Context<InitCompDef>) -> Result<()> {
        msg!("Initializing Reveal Tally Comp Def");
        
        let signature = ComputationSignature {
            parameters: vec![
                Parameter::PlaintextU128,
                Parameter::Ciphertext, Parameter::Ciphertext, Parameter::Ciphertext, Parameter::Ciphertext,
                Parameter::Ciphertext, Parameter::Ciphertext, Parameter::Ciphertext, Parameter::Ciphertext,
            ],
            outputs: vec![
                Output::PlaintextU64, Output::PlaintextU64, Output::PlaintextU64, Output::PlaintextU64,
                Output::PlaintextU64, Output::PlaintextU64, Output::PlaintextU64, Output::PlaintextU64,
            ],
        };
        
        let meta = ComputationDefinitionMeta {
            circuit_len: 477444,
            signature,
        };
        
        let offset = get_noop_offset("reveal_tally");
        init_computation_definition(ctx, offset, meta)
    }
}

// Minimal Sha256 for offset calculation
fn get_noop_offset(label: &str) -> u32 {
    let hash = solana_program::hash::hash(label.as_bytes());
    let bytes = hash.to_bytes();
    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

pub fn init_computation_definition(
    ctx: Context<InitCompDef>,
    comp_offset: u32,
    meta: ComputationDefinitionMeta,
) -> Result<()> {
    // Discriminator for initComputationDefinition: [45, 185, 155, 17, 97, 77, 230, 73]
    let discriminator: [u8; 8] = [45, 185, 155, 17, 97, 77, 230, 73];
    
    let circuit_source = CircuitSource::OnChain(OnChainCircuitSource {
        is_completed: false,
        upload_auth: ctx.accounts.payer.key(),
    });

    let instruction_data = InitComputationDefinitionArgs {
        comp_offset,
        mxe_program: crate::ID, 
        computation_definition: meta,
        circuit_source: Some(circuit_source),
        cu_amount: 1_000_000, 
        finalization_authority: None,
    };
    
    let mut data = Vec::new();
    data.extend_from_slice(&discriminator);
    instruction_data.serialize(&mut data)?;
    
    msg!("Instruction Data Len: {}", data.len());
    msg!("Instruction Data (first 32 bytes): {:?}", &data[..std::cmp::min(data.len(), 32)]);
    if data.len() > 32 {
        msg!("Instruction Data (next 32 bytes): {:?}", &data[32..std::cmp::min(data.len(), 64)]);
    }

    let accounts = vec![
        AccountMeta::new(ctx.accounts.payer.key(), true),
        AccountMeta::new(ctx.accounts.mxe_account.key(), false),
        AccountMeta::new(ctx.accounts.lut.key(), false),
        AccountMeta::new_readonly(ctx.accounts.lut_program.key(), false),
        AccountMeta::new(ctx.accounts.comp_def.key(), false),
        AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
    ];

    let instruction = Instruction {
        program_id: ctx.accounts.arcium_program.key(),
        accounts,
        data,
    };

    solana_program::program::invoke(
        &instruction,
        &[
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.mxe_account.to_account_info(),
            ctx.accounts.lut.to_account_info(),
            ctx.accounts.lut_program.to_account_info(),
            ctx.accounts.comp_def.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;

    Ok(())
}

#[derive(Accounts)]
pub struct InitCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Validated by Arcium program
    #[account(mut)]
    pub mxe_account: UncheckedAccount<'info>,
    /// CHECK: Validated by Arcium program
    #[account(mut)]
    pub comp_def: UncheckedAccount<'info>,
    /// CHECK: Validated by Arcium
    pub lut: UncheckedAccount<'info>,
    /// CHECK: Validated by Arcium
    pub lut_program: UncheckedAccount<'info>,
    /// CHECK: Validated by Arcium
    pub arcium_program: UncheckedAccount<'info>,
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
    /// CHECK: Optional mint for token gating
    pub mint: UncheckedAccount<'info>, 
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitTally<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    #[account(
        init,
        payer = creator,
        space = EncryptedTally::LEN,
        seeds = [b"encrypted_tally", proposal.key().as_ref()],
        bump
    )]
    pub encrypted_tally: Account<'info, EncryptedTally>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    #[account(mut)]
    pub encrypted_tally: Account<'info, EncryptedTally>,
    #[account(
        init,
        payer = voter,
        space = 8,
        seeds = [b"voter", voter.key().as_ref(), proposal.key().as_ref()],
        bump
    )]
    pub voter_record: Account<'info, VoterRecord>,
    
    // Optional token account for eligibility mode 2
    #[account(token::mint = proposal.mint, token::authority = voter)]
    pub voter_token: Option<Account<'info, TokenAccount>>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinalizeTally<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut, has_one = creator)]
    pub proposal: Account<'info, Proposal>,
}

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
    pub finalize_signature: Pubkey,
    pub results: Vec<u64>,
    pub bump: u8,
    pub mint: Pubkey,
    pub whitelist: Vec<Pubkey>,
    pub version: u8,
    pub vote_count: u64,
}

impl Proposal {
    pub const LEN: usize = 8
        + 32
        + TITLE_MAX_LEN
        + 4 + (MAX_OPTIONS * OPTION_MAX_LEN)
        + 8
        + 8
        + 1
        + 1
        + 1
        + 32
        + 4 + (8 * MAX_OPTIONS)
        + 1
        + 32
        + 4 + (MAX_WHITELIST * 32)
        + 1
        + 8;
}

#[account]
pub struct EncryptedTally {
    pub proposal: Pubkey,
    pub last_encrypted_vote: [u8; 32],
    pub bump: u8,
}

impl EncryptedTally {
    pub const LEN: usize = 8 + 32 + 32 + 1;
}

#[account]
pub struct VoterRecord {}

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
}

// --- Arcium Types ---

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitComputationDefinitionArgs {
    pub comp_offset: u32,
    pub mxe_program: Pubkey,
    pub computation_definition: ComputationDefinitionMeta,
    pub circuit_source: Option<CircuitSource>,
    pub cu_amount: u64,
    pub finalization_authority: Option<Pubkey>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ComputationDefinitionMeta {
    pub circuit_len: u32,
    pub signature: ComputationSignature,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ComputationSignature {
    pub parameters: Vec<Parameter>,
    pub outputs: Vec<Output>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum Parameter {
    PlaintextBool,
    PlaintextU8,
    PlaintextU16,
    PlaintextU32,
    PlaintextU64,
    PlaintextU128,
    Ciphertext,
    ArcisX25519Pubkey,
    ArcisSignature,
    PlaintextFloat,
    PlaintextI8,
    PlaintextI16,
    PlaintextI32,
    PlaintextI64,
    PlaintextI128,
    PlaintextPoint,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum Output {
    PlaintextBool,
    PlaintextU8,
    PlaintextU16,
    PlaintextU32,
    PlaintextU64,
    PlaintextU128,
    Ciphertext,
    ArcisX25519Pubkey,
    PlaintextFloat,
    PlaintextPoint,
    PlaintextI8,
    PlaintextI16,
    PlaintextI32,
    PlaintextI64,
    PlaintextI128,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum CircuitSource {
    Local(LocalCircuitSource),
    OnChain(OnChainCircuitSource),
    OffChain(OffChainCircuitSource),
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum LocalCircuitSource {
    MxeKeygen,
    MxeKeyRecoveryInit,
    MxeKeyRecoveryFinalize,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct OnChainCircuitSource {
    pub is_completed: bool,
    pub upload_auth: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct OffChainCircuitSource {
    pub source: String,
    pub hash: [u8; 32],
}
