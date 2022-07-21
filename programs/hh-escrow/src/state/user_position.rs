use anchor_lang::prelude::*;
use solana_program::pubkey::PUBKEY_BYTES;

/// Tracks the user's positions for a given market.
#[account]
#[derive(Default)]
pub struct UserPosition {
    /// The market for which we track positions.
    pub market: Pubkey,
    /// The amount the user has deposited into the yes side.
    pub yes_amount: u64,
    /// The amount the user has deposited into the no side.
    pub no_amount: u64,
}

impl UserPosition {
    pub const LEN: usize = PUBKEY_BYTES + (2 * 8);
}
