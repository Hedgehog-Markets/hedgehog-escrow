use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::Market;

/// Allows the resolver to acknowledge a given market.
#[derive(Accounts)]
pub struct ResolverAcknowledge<'info> {
    /// The market account to acknowledge.
    #[account(mut)]
    pub market: Account<'info, Market>,
    /// The resolver for the market.
    #[account(address = market.resolver @ ErrorCode::IncorrectResolver)]
    pub resolver: Signer<'info>,
}

pub fn handler(ctx: Context<ResolverAcknowledge>) -> Result<()> {
    ctx.accounts.market.acknowledged = true;

    Ok(())
}
