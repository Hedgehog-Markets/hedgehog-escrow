use anchor_lang::prelude::*;

use crate::state::{Outcome, UriResource};

/// The [Market] account.
#[account]
#[derive(Default)]
pub struct Market {
    /// Creator of the market.
    pub creator: Pubkey,
    /// Resolver for the market.
    pub resolver: Pubkey,
    /// The token this market is denominated in.
    pub token_mint: Pubkey,
    /// The token account to escrow tokens placed on the yes side.
    pub yes_token_account: Pubkey,
    /// The token account to escrow tokens placed on the no side.
    pub no_token_account: Pubkey,
    /// The amount of tokens to fill the yes side.
    pub yes_amount: u64,
    /// The amount of tokens placed on the yes side.
    pub yes_filled: u64,
    /// The amount of tokens to fill the no side.
    pub no_amount: u64,
    /// The amount of tokens placed on the no side.
    pub no_filled: u64,
    /// The timestamp at which the market closes (i.e. does not accept new
    /// funds).
    pub close_ts: u64,
    /// The timestamp at which the market can be resolved.
    pub expiry_ts: u64,
    /// The timestamp of when a market has been set to an outcome. 0 if not set.
    pub outcome_ts: u64,
    /// The delay in seconds before the outcome is finalized.
    pub resolution_delay: u32,
    /// The outcome of the market.
    pub outcome: Outcome,
    /// A flag checking whether the market is finalized.
    pub finalized: bool,
    /// The bump seed for the yes token account.
    pub yes_account_bump: u8,
    /// The bump seed for the no token account.
    pub no_account_bump: u8,
    /// The URI to the market's info (i.e. title, description)
    pub uri: UriResource,
}

impl Market {
    pub const LEN: usize = 5 * 32 + 7 * 8 + 4 + 1 + 1 + 2 * 1 + UriResource::LEN;
}
