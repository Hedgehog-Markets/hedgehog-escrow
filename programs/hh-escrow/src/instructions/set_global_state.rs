use anchor_lang::prelude::*;
use solana_program::entrypoint::ProgramResult;

use crate::error::ErrorCode;
use crate::state::{Bps, GlobalState};

#[derive(Clone, AnchorDeserialize, AnchorSerialize)]
pub struct SetGlobalStateParams {
    new_owner: Pubkey,
    new_fee_cut_bps: u16,
    new_fee_wallet: Pubkey,
}

#[derive(Accounts)]
#[instruction(params: SetGlobalStateParams)]
pub struct SetGlobalState<'info> {
    /// The global state account.
    #[account(
        mut,
        seeds = [b"global"],
        bump,
        has_one = owner @ ErrorCode::IncorrectGlobalStateOwner,
    )]
    pub global_state: Account<'info, GlobalState>,
    pub owner: Signer<'info>,
}

pub fn handler(ctx: Context<SetGlobalState>, params: SetGlobalStateParams) -> ProgramResult {
    let SetGlobalStateParams {
        new_owner,
        new_fee_cut_bps,
        new_fee_wallet,
    } = params;
    let global_state = &mut ctx.accounts.global_state;

    global_state.fee_cut_bps =
        Bps::new(new_fee_cut_bps).ok_or_else(|| error!(ErrorCode::FeeTooHigh))?;
    global_state.owner = new_owner;
    global_state.fee_wallet = new_fee_wallet;

    Ok(())
}
