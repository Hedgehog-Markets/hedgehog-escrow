use anchor_lang::prelude::*;
use solana_program::entrypoint::ProgramResult;

use crate::state::{Market, UserPosition};

/// Initializes a [UserPosition] account for the user.
/// 
/// Before initializing, checks if the market requires any state update. If it
/// should be finalized, then it finalizes the market and exists early.
#[derive(Accounts)]
pub struct InitializeUserPosition<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(
        init,
        payer = payer,
        seeds = [b"user", user.key().as_ref(), market.key().as_ref()],
        bump,
        space = 8 + UserPosition::LEN,
    )]
    pub user_position: Account<'info, UserPosition>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeUserPosition>) -> ProgramResult {
    let user_position = &mut ctx.accounts.user_position;
    user_position.market = ctx.accounts.market.key();

    Ok(())
}
