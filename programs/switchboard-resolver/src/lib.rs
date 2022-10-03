use anchor_lang::prelude::*;

#[macro_use]
mod macros;

pub mod error;
pub mod instructions;
pub mod state;

use crate::instructions::*;

pub use crate::error::ErrorCode;

declare_id!("CyX3buQXyW939M5LReVhPGwcTDoPWMAdArehA2aqVRvP");

#[program]
pub mod hyperspace_resolver {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    pub fn resolve(ctx: Context<Resolve>) -> Result<()> {
        instructions::resolve::handler(ctx)
    }
}
