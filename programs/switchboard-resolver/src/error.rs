#[anchor_lang::error_code]
pub enum ErrorCode {
    #[msg("Missing bump seed.")]
    MissingBumpSeed,
    #[msg("Resolver does not match the market resolver address")]
    IncorrectResolver,
    #[msg("Creator does not match the market creator address")]
    IncorrectCreator,
    #[msg("Market does not match the resolver market address")]
    IncorrectMarket,
    #[msg("Cannot resolve before timestamp")]
    TimestampNotPassed,
}
