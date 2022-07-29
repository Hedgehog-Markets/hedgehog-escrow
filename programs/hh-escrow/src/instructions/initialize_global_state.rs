use anchor_lang::prelude::*;

use common::traits::KeyRef;

use crate::error::ErrorCode;
use crate::program::HhEscrow;
use crate::state::{Bps, GlobalState};

/// Parameters for initializing the global state.
#[derive(Clone, AnchorDeserialize, AnchorSerialize)]
pub struct InitializeGlobalStateParams {
    /// The authority for the global state.
    ///
    /// The authority can change certain global state parameters.
    authority: Pubkey,
    /// The owner of the account that will hold protocol fees.
    fee_wallet: Pubkey,
    /// The protocol fee (in basis points).
    protocol_fee_bps: u16,
}

/// Initializes a global state that holds protocol fee parameters.
#[derive(Accounts)]
#[instruction(params: InitializeGlobalStateParams)]
pub struct InitializeGlobalState<'info> {
    /// The global state account to initialize.
    #[account(
        init,
        seeds = [b"global"],
        bump,
        payer = payer,
        space = 8 + GlobalState::LEN,
    )]
    pub global_state: Account<'info, GlobalState>,

    /// Payer for the transaction.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The program's upgrade authority.
    pub upgrade_authority: Signer<'info>,
    /// The escrow program.
    ///
    /// Provided here to check the upgrade authority.
    #[account(constraint = escrow_program.programdata_address()?.as_ref() == Some(program_data.key_ref()) @ ErrorCode::InvalidProgramData)]
    pub escrow_program: Program<'info, HhEscrow>,
    /// The program data account for the escrow program.
    ///
    /// Provided to check the upgrade authority.
    #[account(constraint = program_data.upgrade_authority_address.as_ref() == Some(upgrade_authority.key_ref()) @ ErrorCode::InvalidProgramUpgradeAuthority)]
    pub program_data: Account<'info, ProgramData>,

    /// The Solana System Program.
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeGlobalState>,
    params: InitializeGlobalStateParams,
) -> Result<()> {
    let global_state = &mut ctx.accounts.global_state;

    global_state.protocol_fee_bps =
        Bps::new(params.protocol_fee_bps).ok_or_else(|| error!(ErrorCode::FeeTooHigh))?;

    global_state.authority = params.authority;
    global_state.fee_wallet = params.fee_wallet;

    Ok(())
}
