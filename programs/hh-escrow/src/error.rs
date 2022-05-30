use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Market resource is invalid.")]
    InvalidMarketResource,
    #[msg("Close timestamp must be greater than the present time.")]
    InvalidCloseTimestamp,
    #[msg("Expiry timestamp must be greater than the close timestamp.")]
    InvalidExpiryTimestamp,
}
