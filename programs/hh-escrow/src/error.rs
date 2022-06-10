use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Market resource is invalid.")]
    InvalidMarketResource,
    #[msg("Close timestamp must be greater than the present time.")]
    InvalidCloseTimestamp,
    #[msg("Expiry timestamp must be greater than the close timestamp.")]
    InvalidExpiryTimestamp,
    #[msg("Bump seed was non canonical.")]
    NonCanonicalBumpSeed,
    #[msg("Numerical overflow occurred.")]
    Overflow,
    #[msg("This market is already finalized.")]
    AlreadyFinalized,
    #[msg("This market is closed for trading.")]
    MarketClosed,
    #[msg("Attempted to add more than the allowed amount.")]
    OverAllowedAmount,
    #[msg("Token account does not match the market yes token account.")]
    IncorrectYesEscrow,
    #[msg("Token account does not match the market no token account.")]
    IncorrectNoEscrow,
    #[msg("Resolver does not match the market resolver.")]
    IncorrectResolver,
    #[msg("This status transition is not allowed.")]
    InvalidTransition,
    #[msg("Can only withdraw from an invalid market.")]
    MarketNotInvalid,
    #[msg("This market is not finalized.")]
    NotFinalized,
    #[msg("The provided fee is too high.")]
    FeeTooHigh,
    #[msg("The provided program data is incorrect.")]
    InvalidProgramData,
    #[msg("The provided program authority is incorrect.")]
    InvalidProgramAuthority,
    #[msg("The provided global state owner is incorrect.")]
    IncorrectGlobalStateOwner,
}
