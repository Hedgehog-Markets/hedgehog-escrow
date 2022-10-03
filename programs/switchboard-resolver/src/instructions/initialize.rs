use anchor_lang::prelude::*;
use switchboard_v2::AggregatorAccountData;

use common::traits::KeyRef;
use hh_escrow::program::HhEscrow;
use hh_escrow::state::Market;

use crate::error::ErrorCode;
use crate::state::{Resolver, RESOLVER_SEED};

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// The metadata account for the resolver.
    #[account(
        init,
        seeds = [RESOLVER_SEED, market.key_ref().as_ref()],
        bump,
        space = Resolver::LEN,
        payer = creator,
    )]
    pub resolver: Account<'info, Resolver>,
    /// The market to resolve.
    #[account(mut, constraint = market.resolver == *resolver.key_ref() @ ErrorCode::IncorrectResolver)]
    pub market: Account<'info, Market>,
    /// The Switchboard aggregator feed.
    ///
    /// CHECK: This account will be checked in the handler.
    pub feed: UncheckedAccount<'info>,
    /// The market creator.
    #[account(mut, address = market.creator @ ErrorCode::IncorrectCreator)]
    pub creator: Signer<'info>,

    /// The escrow program.
    pub escrow_program: Program<'info, HhEscrow>,
    /// The Solana system program.
    pub system_program: Program<'info, System>,
}

impl<'info> Initialize<'info> {
    /// Acknowledge the market.
    fn resolver_acknowledge(&self, signer_seeds: &[&[&[u8]]]) -> Result<()> {
        let ctx = CpiContext::new_with_signer(
            self.escrow_program.to_account_info(),
            hh_escrow::cpi::accounts::ResolverAcknowledge {
                market: self.market.to_account_info(),
                resolver: self.resolver.to_account_info(),
            },
            signer_seeds,
        );
        hh_escrow::cpi::resolver_acknowledge(ctx)
    }
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    let Initialize {
        resolver,
        ref market,
        ref feed,
        ..
    } = ctx.accounts;

    // Attempt to load the feed account, to validate the account data.
    AggregatorAccountData::new(feed)?;

    resolver.market = market.key();
    resolver.feed = feed.key();

    let bump = get_bump!(ctx, resolver)?;
    let signer_seeds = &[
        RESOLVER_SEED,
        ctx.accounts.market.key_ref().as_ref(),
        &[bump],
    ];

    // Acknowledge the market.
    ctx.accounts.resolver_acknowledge(&[signer_seeds])?;

    Ok(())
}
