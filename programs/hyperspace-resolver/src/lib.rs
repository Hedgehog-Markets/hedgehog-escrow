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

    pub fn initialize_nft_floor(
        ctx: Context<InitializeNftFloor>,
        params: InitializeNftFloorParams,
    ) -> Result<()> {
        instructions::initialize_nft_floor::handler(ctx, params)
    }

    pub fn resolve_nft_floor(
        ctx: Context<ResolveNftFloor>,
        params: ResolveNftFloorParams,
    ) -> Result<()> {
        instructions::resolve_nft_floor::handler(ctx, params)
    }
}
