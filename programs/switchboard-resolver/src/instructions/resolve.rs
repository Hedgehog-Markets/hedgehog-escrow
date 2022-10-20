use anchor_lang::prelude::*;

use common::sys;
use common::traits::KeyRef;
use hh_escrow::program::HhEscrow;
use hh_escrow::state::{Market, Outcome};

use crate::error::ErrorCode;
use crate::state::{Resolver, RESOLVER_SEED};
use crate::utils::load_aggregator_account;

#[derive(Accounts)]
pub struct Resolve<'info> {
    /// The metadata account for the resolver.
    #[account(seeds = [RESOLVER_SEED, market.key_ref().as_ref()], bump)]
    pub resolver: Account<'info, Resolver>,
    /// The market to resolve.
    #[account(mut, constraint = market.resolver == *resolver.key_ref() @ ErrorCode::IncorrectResolver)]
    pub market: Account<'info, Market>,
    /// The Switchboard aggregator feed.
    ///
    /// CHECK: This account will be checked in the handler.
    pub feed: UncheckedAccount<'info>,

    /// The escrow program.
    pub escrow_program: Program<'info, HhEscrow>,
    /// The Solana system program.
    pub system_program: Program<'info, System>,
}

impl<'info> Resolve<'info> {
    /// Resolves the market.
    pub fn resolve(&self, signer_seeds: &[&[&[u8]]], outcome: Outcome) -> Result<()> {
        let ctx = CpiContext::new_with_signer(
            self.escrow_program.to_account_info(),
            hh_escrow::cpi::accounts::UpdateState {
                market: self.market.to_account_info(),
                resolver: self.resolver.to_account_info(),
            },
            signer_seeds,
        );
        hh_escrow::cpi::update_state(ctx, hh_escrow::instructions::UpdateStateParams { outcome })
    }
}

pub fn handler(ctx: Context<Resolve>) -> Result<()> {
    let Resolve {
        ref market,
        ref feed,
        ..
    } = ctx.accounts;

    // Check that the timestamp has passed.
    if market.expiry_ts > sys::timestamp()? {
        return Err(error!(ErrorCode::TimestampNotPassed));
    }

    let result = load_aggregator_account(feed)?.get_result()?;
    let outcome = if result.scale == 0 {
        let result = result.mantissa;

        match result {
            1 => Outcome::Yes,
            2 => Outcome::No,
            _ => {
                msg!("Invalid feed result: {}", result);

                Outcome::Invalid
            }
        }
    } else {
        let mantissa = result.mantissa;
        let scale = result.scale;

        msg!(
            "Invalid feed result: mantissa = {}, scale = {}",
            mantissa,
            scale,
        );

        Outcome::Invalid
    };

    let bump = get_bump!(ctx, resolver)?;
    let signer_seeds = &[
        RESOLVER_SEED,
        ctx.accounts.market.key_ref().as_ref(),
        &[bump],
    ];

    // Resolve the market.
    ctx.accounts.resolve(&[signer_seeds], outcome)?;

    Ok(())
}
