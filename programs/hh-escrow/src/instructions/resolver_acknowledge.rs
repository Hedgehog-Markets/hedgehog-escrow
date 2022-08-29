use anchor_lang::prelude::*;
use solana_program::entrypoint::ProgramResult;

use crate::error::ErrorCode;
use crate::state::{Market};

/// Allows the resolver to acknowledge a given market.
#[derive(Accounts)]
pub struct ResolverAcknowledge<'info> {
    /// The market account to acknowledge.
    #[account(mut, has_one = resolver @ ErrorCode::IncorrectResolver)]
    pub market: Account<'info, Market>,
    /// The resolver for the market.
    pub resolver: Signer<'info>,
}

pub fn handler(
    ctx: Context<ResolverAcknowledge>,
) -> ProgramResult {
    let market = &mut ctx.accounts.market;

    market.acknowledged = true;

    Ok(())
}
