use anchor_lang::prelude::*;

use crate::state::Bps;

/// The [GlobalState] account.
#[account]
#[derive(Default)]
pub struct GlobalState {
    /// The owner of the global state account.
    pub owner: Pubkey,
    /// The protocol fee in basis points.
    pub fee_cut_bps: Bps,
    /// The wallet which will own the protocol fee.
    pub fee_wallet: Pubkey,
}

impl GlobalState {
    pub const LEN: usize = 32 + 2 + 32;
}
