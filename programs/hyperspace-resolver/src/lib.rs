use anchor_lang::prelude::*;

mod utils;

pub mod error;
pub mod instructions;
pub mod state;

use crate::instructions::*;

pub use crate::error::ErrorCode;

// TODO: Update this to the actual program id.
declare_id!("D8hrkYK4T2NAnJzRduu7uc9kLSEPgh8y6RAXB5J9Q8G5");

#[program]
pub mod hyperspace_resolver {
    use super::*;

    pub fn initialize_nft_floor(
        ctx: Context<InitializeNftFloorResolver>,
        params: InitializeNftFloorResolverParams,
    ) -> Result<()> {
        instructions::initialize_nft_floor::handler(ctx, params)
    }
}
