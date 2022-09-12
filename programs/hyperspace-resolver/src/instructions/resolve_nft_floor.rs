use anchor_lang::prelude::*;

use common::sys;
use common::traits::KeyRef;
use hh_escrow::program::HhEscrow;
use hh_escrow::state::{Market, Outcome};

use crate::error::ErrorCode;
use crate::state::{NftFloor, NFT_FLOOR_SEED};

#[derive(Clone, AnchorDeserialize, AnchorSerialize)]
pub struct ResolveNftFloorParams {
    /// The current floor price in lamports.
    pub current_floor_price: u64,
}

#[derive(Accounts)]
pub struct ResolveNftFloor<'info> {
    /// The metadata account for the resolver.
    #[account(seeds = [NFT_FLOOR_SEED, resolver.market.key_ref().as_ref()], bump)]
    pub resolver: Account<'info, NftFloor>,
    /// The market to resolve.
    #[account(mut, address = resolver.market @ ErrorCode::IncorrectMarket)]
    pub market: Account<'info, Market>,
    /// The resolver authority.
    #[account(address = resolver.authority @ ErrorCode::IncorrectAuthority)]
    pub authority: Signer<'info>,

    /// The escrow program.
    pub escrow_program: Program<'info, HhEscrow>,
}

impl<'info> ResolveNftFloor<'info> {
    /// Resolves the market.
    pub fn resolve(&self, signer_seeds: &[&[&[u8]]], outcome: Outcome) -> Result<()> {
        let accounts = hh_escrow::cpi::accounts::UpdateState {
            market: self.market.to_account_info(),
            resolver: self.resolver.to_account_info(),
        };
        let ctx = CpiContext::new_with_signer(
            self.escrow_program.to_account_info(),
            accounts,
            signer_seeds,
        );

        let params = hh_escrow::instructions::UpdateStateParams { outcome };

        hh_escrow::cpi::update_state(ctx, params)
    }
}

pub fn handler(ctx: Context<ResolveNftFloor>, params: ResolveNftFloorParams) -> Result<()> {
    let ResolveNftFloorParams {
        current_floor_price,
    } = params;

    // Check that the timestamp has passed.
    if ctx.accounts.market.expiry_ts > sys::timestamp()? {
        return Err(error!(ErrorCode::TimestampNotPassed));
    }

    // Resolve to `Yes` if the current floor price is greater than or equal to
    // the market floor price.
    let outcome = if current_floor_price >= ctx.accounts.resolver.floor_price {
        Outcome::Yes
    } else {
        Outcome::No
    };

    let bump = get_bump!(ctx, resolver)?;
    let signer_seeds = &[
        NFT_FLOOR_SEED,
        ctx.accounts.market.key_ref().as_ref(),
        &[bump],
    ];

    // Resolve the market.
    ctx.accounts.resolve(&[signer_seeds], outcome)?;

    Ok(())
}
