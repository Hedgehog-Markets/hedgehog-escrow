#![allow(clippy::result_large_err)]

use anchor_lang::prelude::*;

#[macro_use]
mod macros;

pub mod error;
pub mod instructions;
pub mod state;
pub mod utils;

use crate::instructions::*;

pub use crate::error::ErrorCode;

// TODO: Update to real address later.
declare_id!("Be7cUjJjBaF1tarJo4aXCYPnMr1xUAvyApaCQovt9kN");

#[program]
pub mod switchboard_resolver {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    pub fn resolve(ctx: Context<Resolve>) -> Result<()> {
        instructions::resolve::handler(ctx)
    }
}
