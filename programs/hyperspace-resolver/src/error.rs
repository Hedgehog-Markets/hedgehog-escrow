#[anchor_lang::error_code]
pub enum ErrorCode {
    #[msg("Resolver does not match the market resolver address")]
    IncorrectResolver,
    #[msg("Creator does not match the market creator address")]
    IncorrectCreator,
    #[msg("The timestamp has already passed")]
    TimestampPassed,
}
