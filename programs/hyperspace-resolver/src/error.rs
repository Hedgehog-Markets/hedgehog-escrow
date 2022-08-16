#[anchor_lang::error_code]
pub enum ErrorCode {
    #[msg("Missing bump seed.")]
    MissingBumpSeed,
    #[msg("Resolver does not match the market resolver address")]
    IncorrectResolver,
    #[msg("Creator does not match the market creator address")]
    IncorrectCreator,
    #[msg("Authority does not match the resolver authority address")]
    IncorrectAuthority,
    #[msg("Cannot create resolver for timestamp that has already passed")]
    TimestampPassed,
    #[msg("Cannot resolve before timestamp")]
    TimestampNotPassed,
}
