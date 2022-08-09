use anchor_lang::prelude::*;

use crate::state::{Market, UserPosition};

/// Initializes a [`UserPosition`] account for the user.
///
/// Before initializing, checks if the market requires any state update. If it
/// should be finalized, then it finalizes the market and exists early.
#[derive(Accounts)]
pub struct InitializeUserPosition<'info> {
    /// The user position to initialize.
    #[account(
        init,
        payer = payer,
        seeds = [b"user", user.key().as_ref(), market.key().as_ref()],
        bump,
        space = 8 + UserPosition::LEN,
    )]
    pub user_position: Account<'info, UserPosition>,
    /// The market the user position is for.
    pub market: Account<'info, Market>,
    /// The user.
    #[account(mut)]
    pub user: Signer<'info>,

    /// The payer for the transaction.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The Solana system program.
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeUserPosition>) -> Result<()> {
    ctx.accounts.user_position.market = ctx.accounts.market.key();

    Ok(())
}
