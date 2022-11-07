#![allow(clippy::result_large_err)]

use anchor_lang::prelude::*;

#[macro_use]
mod macros;

pub mod error;
pub mod instructions;
pub mod state;

use crate::instructions::*;

pub use crate::error::ErrorCode;

declare_id!("8kjTCbyh98kFMDsCkCMUwDj3TNJh4f5fREquiVLUCX2P");

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
