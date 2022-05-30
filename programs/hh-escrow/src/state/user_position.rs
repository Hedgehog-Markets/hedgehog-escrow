use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct UserPosition {
    pub market: Pubkey,
    pub yes_amount: u64,
    pub no_amount: u64,
}

impl UserPosition {
    pub const LEN: usize = 32 + 2 * 8;
}
