use std::slice;

use anchor_lang::prelude::*;

use common::traits::KeyRef;
use hh_escrow::program::HhEscrow;
use hh_escrow::state::Market;

use crate::error::ErrorCode;
use crate::state::{Resolver, RESOLVER_SEED};
use crate::utils::load_aggregator_account;

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// The metadata account for the resolver.
    ///
    /// CHECK: This account will be initialized in the handler.
    #[account(mut, seeds = [RESOLVER_SEED, market.key_ref().as_ref()], bump)]
    pub resolver: UncheckedAccount<'info>,
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
    /// Initializes the resolver account.
    ///
    /// This allows us to provide more user accessible errors.
    fn init_resolver(&self, signer_seeds: &[&[&[u8]]]) -> Result<Account<'info, Resolver>> {
        let resolver = &*self.resolver;
        let payer = &*self.creator;

        const SPACE: usize = 8 + Resolver::LEN;
        const SPACE_U64: u64 = SPACE as u64;

        let required_lamports = Rent::get()?.minimum_balance(SPACE);
        let lamports = resolver.lamports();

        if lamports == 0 {
            // Create a new account.
            solana_program::program::invoke_signed(
                &solana_program::system_instruction::create_account(
                    payer.key,
                    resolver.key,
                    required_lamports,
                    SPACE_U64,
                    &crate::ID,
                ),
                &[payer.to_account_info(), resolver.to_account_info()],
                signer_seeds,
            )?;
        } else {
            let required_lamports = required_lamports.max(1).saturating_sub(lamports);
            if required_lamports > 0 {
                // Top up lamports.
                solana_program::program::invoke(
                    &solana_program::system_instruction::transfer(
                        payer.key,
                        resolver.key,
                        required_lamports,
                    ),
                    &[payer.to_account_info(), resolver.to_account_info()],
                )?;
            }

            // Avoid cloning resolver account info again.
            let resolver_info = slice::from_ref(resolver);

            // Allocate space for the account.
            solana_program::program::invoke_signed(
                &solana_program::system_instruction::allocate(resolver.key, SPACE_U64),
                resolver_info,
                signer_seeds,
            )?;

            // Assign this program as the account owner.
            solana_program::program::invoke_signed(
                &solana_program::system_instruction::assign(resolver.key, &crate::ID),
                resolver_info,
                signer_seeds,
            )?;
        }

        Account::try_from_unchecked(resolver).map_err(|err| err.with_account_name("resolver"))
    }

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
        ref market,
        ref feed,
        ..
    } = ctx.accounts;

    // Attempt to load the feed account, to validate the account data.
    load_aggregator_account(feed).map_err(|err| err.with_account_name("feed"))?;

    let bump = get_bump!(ctx, resolver)?;
    let signer_seeds = &[
        RESOLVER_SEED,
        ctx.accounts.market.key_ref().as_ref(),
        &[bump],
    ];

    {
        let mut resolver = ctx.accounts.init_resolver(&[signer_seeds])?;

        resolver.market = market.key();
        resolver.feed = feed.key();

        resolver.exit(ctx.program_id)?;
    }

    // Acknowledge the market.
    ctx.accounts.resolver_acknowledge(&[signer_seeds])?;

    Ok(())
}
