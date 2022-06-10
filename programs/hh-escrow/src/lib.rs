use anchor_lang::prelude::*;
use solana_program::entrypoint::ProgramResult;

pub mod error;
pub mod instructions;
pub mod state;
pub mod utils;

use crate::instructions::*;

declare_id!("27yeAvyRBxkiYT2NqZBjJDe4PNRcCxyqVQ1yXBpj2Hjt");

#[derive(Clone)]
pub struct HhEscrow;

impl Id for HhEscrow {
    fn id() -> Pubkey {
        ID
    }
}

#[program]
pub mod hh_escrow {
    use super::*;

    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        params: InitializeMarketParams,
    ) -> ProgramResult {
        instructions::initialize_market::handler(ctx, params)
    }

    pub fn initialize_user_position(ctx: Context<InitializeUserPosition>) -> ProgramResult {
        instructions::initialize_user_position::handler(ctx)
    }

    pub fn deposit(ctx: Context<Deposit>, params: DepositParams) -> ProgramResult {
        instructions::deposit::handler(ctx, params)
    }

    pub fn update_state(ctx: Context<UpdateState>, params: UpdateStateParams) -> ProgramResult {
        instructions::update_state::handler(ctx, params)
    }

    pub fn withdraw(ctx: Context<Withdraw>) -> ProgramResult {
        instructions::withdraw::handler(ctx)
    }

    pub fn initialize_global_state(
        ctx: Context<InitializeGlobalState>,
        params: InitializeGlobalStateParams,
    ) -> ProgramResult {
        instructions::initialize_global_state::handler(ctx, params)
    }

    pub fn claim(ctx: Context<Claim>) -> ProgramResult {
        instructions::claim::handler(ctx)
    }

    pub fn set_global_state(
        ctx: Context<SetGlobalState>,
        params: SetGlobalStateParams,
    ) -> ProgramResult {
        instructions::set_global_state::handler(ctx, params)
    }

    pub fn resolver_acknowledge(ctx: Context<ResolverAcknowledge>) -> ProgramResult {
        instructions::resolver_acknowledge::handler(ctx)
    }
}
