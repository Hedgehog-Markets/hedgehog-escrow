use anchor_lang::prelude::*;
use solana_program::entrypoint::ProgramResult;

use crate::error::ErrorCode;
use crate::state::{Bps, GlobalState};
use crate::HhEscrow;

/// Parameters for initializing the global state.
#[derive(Clone, AnchorDeserialize, AnchorSerialize)]
pub struct InitializeGlobalStateParams {
    protocol_fee_bps: u16,
}

/// Initializes a global state that holds protocol fee parameters.
#[derive(Accounts)]
#[instruction(params: InitializeGlobalStateParams)]
pub struct InitializeGlobalState<'info> {
    /// The global state account to initialize.
    #[account(init, seeds = [b"global"], bump, payer = payer, space = 8 + GlobalState::LEN)]
    pub global_state: Account<'info, GlobalState>,
    /// The program's upgrade authority.
    pub authority: Signer<'info>,
    /// The owner for the global state.
    ///
    /// CHECK: We only need the public key from this account.
    pub global_state_owner: AccountInfo<'info>,
    /// The account that will hold protocol fees.
    ///
    /// CHECK: We only need the public key from this account.
    pub fee_wallet: AccountInfo<'info>,
    /// The outcome program. Provided here to check the upgrade authority.
    #[account(constraint = escrow_program.programdata_address()? == Some(program_data.key()) @ ErrorCode::InvalidProgramData)]
    pub escrow_program: Program<'info, HhEscrow>,
    /// The outcome program's program data account. Provided to check the
    /// upgrade authority.
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ ErrorCode::InvalidProgramAuthority)]
    pub program_data: Account<'info, ProgramData>,
    /// The Solana System Program.
    pub system_program: Program<'info, System>,
    /// Payer for the global state account.
    #[account(mut)]
    pub payer: Signer<'info>,
}

pub fn handler(
    ctx: Context<InitializeGlobalState>,
    params: InitializeGlobalStateParams,
) -> ProgramResult {
    let global_state = &mut ctx.accounts.global_state;
    
    global_state.fee_cut_bps =
        Bps::new(params.protocol_fee_bps).ok_or_else(|| error!(ErrorCode::FeeTooHigh))?;
    global_state.owner = ctx.accounts.global_state_owner.key();
    global_state.fee_wallet = ctx.accounts.fee_wallet.key();

    Ok(())
}
