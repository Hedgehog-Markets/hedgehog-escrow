use anchor_lang::prelude::*;

#[macro_use]
mod macros;
mod utils;

pub mod error;
pub mod instructions;
pub mod state;

use crate::instructions::*;

pub use crate::error::ErrorCode;

declare_id!("Yb4spZYFpgad4pDvV1mdU7pFU9vQWNeDS4degy7eR1u");

#[program]
pub mod hh_escrow {
    use super::*;

    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        params: InitializeMarketParams,
    ) -> Result<()> {
        instructions::initialize_market::handler(ctx, params)
    }

    pub fn initialize_user_position(ctx: Context<InitializeUserPosition>) -> Result<()> {
        instructions::initialize_user_position::handler(ctx)
    }

    pub fn deposit(ctx: Context<Deposit>, params: DepositParams) -> Result<()> {
        instructions::deposit::handler(ctx, params)
    }

    pub fn update_outcome(ctx: Context<UpdateOutcome>, params: UpdateOutcomeParams) -> Result<()> {
        instructions::update_outcome::handler(ctx, params)
    }

    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        instructions::withdraw::handler(ctx)
    }

    pub fn initialize_global_state(
        ctx: Context<InitializeGlobalState>,
        params: InitializeGlobalStateParams,
    ) -> Result<()> {
        instructions::initialize_global_state::handler(ctx, params)
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        instructions::claim::handler(ctx)
    }

    pub fn set_global_state(
        ctx: Context<SetGlobalState>,
        params: SetGlobalStateParams,
    ) -> Result<()> {
        instructions::set_global_state::handler(ctx, params)
    }

    pub fn resolver_acknowledge(ctx: Context<ResolverAcknowledge>) -> Result<()> {
        instructions::resolver_acknowledge::handler(ctx)
    }
}
