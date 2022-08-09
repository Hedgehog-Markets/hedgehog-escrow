use anchor_lang::prelude::*;
use solana_program::pubkey::PUBKEY_BYTES;

use crate::state::Bps;

/// The program global state account.
#[account]
#[derive(Default)]
pub struct GlobalState {
    /// The owner of the global state account.
    pub authority: Pubkey,
    /// The wallet which will own the protocol fee.
    pub fee_wallet: Pubkey,
    /// The protocol fee (in basis points).
    pub protocol_fee_bps: Bps,
}

impl GlobalState {
    pub const LEN: usize = (2 * PUBKEY_BYTES) + Bps::LEN;
}
