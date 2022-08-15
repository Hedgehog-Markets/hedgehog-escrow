use std::slice;

use anchor_lang::prelude::*;

use common::traits::KeyRef;
use hh_escrow::program::HhEscrow;
use hh_escrow::state::Market;

use crate::error::ErrorCode;
use crate::state::{NftFloor, NFT_FLOOR_SEED};
use crate::utils;

#[derive(Clone, AnchorDeserialize, AnchorSerialize)]
pub struct InitializeNftFloorResolverParams {
    /// The time at which to resolve the market.
    pub timestamp: i64,
    /// The floor price in lamports to compare to when resolving.
    pub floor_price: u64,
    /// The project ID of the collection.
    pub project_id: String,
}

#[derive(Accounts)]
pub struct InitializeNftFloorResolver<'info> {
    /// The metadata account for the resolver.
    ///
    /// CHECK: This account will be initialized in the handler.
    #[account(mut, seeds = [NFT_FLOOR_SEED, market.key_ref().as_ref()], bump)]
    pub resolver: UncheckedAccount<'info>,
    /// The market to resolve.
    #[account(constraint = market.resolver == *resolver.key_ref() @ ErrorCode::IncorrectResolver)]
    pub market: Account<'info, Market>,
    /// The market creator.
    #[account(address = market.creator @ ErrorCode::IncorrectCreator)]
    pub creator: Signer<'info>,

    /// The payer for the transaction.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The escrow program.
    pub escrow_program: Program<'info, HhEscrow>,
    /// The Solana system program.
    pub system_program: Program<'info, System>,
}

impl<'info> InitializeNftFloorResolver<'info> {
    /// Initializes the resolver account.
    ///
    /// This has to be done manually because the resolver account size varies
    /// depending on the project ID.
    fn init_resolver(&self, project_id: &str) -> Result<Account<'info, NftFloor>> {
        let resolver = &*self.resolver;
        let payer = &*self.payer;

        let space = 8 + NftFloor::account_size(project_id);

        let required_lamports = Rent::get()?.minimum_balance(space);
        let lamports = resolver.lamports();

        let signer_seeds = &[NFT_FLOOR_SEED, self.market.key_ref().as_ref()];

        if lamports == 0 {
            // Create a new account.
            solana_program::program::invoke_signed(
                &solana_program::system_instruction::create_account(
                    payer.key,
                    resolver.key,
                    required_lamports,
                    space as u64,
                    &crate::ID,
                ),
                &[payer.to_account_info(), resolver.to_account_info()],
                &[signer_seeds],
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
                &solana_program::system_instruction::allocate(resolver.key, space as u64),
                resolver_info,
                &[signer_seeds],
            )?;

            // Assign this program as the account owner.
            solana_program::program::invoke_signed(
                &solana_program::system_instruction::assign(resolver.key, &crate::ID),
                resolver_info,
                &[signer_seeds],
            )?;
        }

        Account::try_from_unchecked(resolver).map_err(|err| err.with_account_name("resolver"))
    }

    /// Acknowledge the market.
    fn resolver_acknowledge(&self) -> Result<()> {
        let accounts = hh_escrow::cpi::accounts::ResolverAcknowledge {
            market: self.market.to_account_info(),
            resolver: self.resolver.to_account_info(),
        };
        let ctx = CpiContext::new(self.escrow_program.to_account_info(), accounts);

        hh_escrow::cpi::resolver_acknowledge(ctx)
    }
}

pub fn handler(
    ctx: Context<InitializeNftFloorResolver>,
    params: InitializeNftFloorResolverParams,
) -> Result<()> {
    let InitializeNftFloorResolverParams {
        timestamp,
        floor_price,
        project_id,
    } = params;

    // Check that the timestamp has not already passed.
    if timestamp <= utils::unix_timestamp()? {
        return Err(error!(ErrorCode::TimestampPassed));
    }

    // Create or allocate space for the resolver account.
    let mut resolver = ctx.accounts.init_resolver(&project_id)?;

    resolver.market = ctx.accounts.market.key();
    resolver.timestamp = timestamp;
    resolver.floor_price = floor_price;
    resolver.project_id = project_id.to_string();

    // Write the resolver account.
    resolver.exit(&crate::ID)?;

    // Acknowledge the market.
    ctx.accounts.resolver_acknowledge()?;

    Ok(())
}
