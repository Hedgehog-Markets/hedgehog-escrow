use anchor_lang::prelude::*;
use solana_program::entrypoint::ProgramResult;

pub mod error;
pub mod instructions;
pub mod state;

use crate::instructions::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod hh_escrow {
    use super::*;

    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        params: InitializeMarketParams,
    ) -> ProgramResult {
        instructions::initialize_market::handler(ctx, params)
    }
}

#[derive(Accounts)]
pub struct Initialize {}
