use anchor_lang::prelude::*;

use common::traits::KeyRef;

use crate::error::ErrorCode;
use crate::state::{NftFloor, NFT_FLOOR_SEED};

#[derive(Accounts)]
pub struct AcknowledgeNftFloor<'info> {
    /// The metadata account for the resolver.
    #[account(mut, seeds = [NFT_FLOOR_SEED, resolver.market.key_ref().as_ref()], bump)]
    pub resolver: Account<'info, NftFloor>,
    /// The resolver authority.
    #[account(address = resolver.authority @ ErrorCode::IncorrectAuthority)]
    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<AcknowledgeNftFloor>) -> Result<()> {
    if ctx.accounts.resolver.acknowledged {
        return Err(error!(ErrorCode::AlreadyAcknowledged));
    }

    ctx.accounts.resolver.acknowledged = true;

    Ok(())
}
