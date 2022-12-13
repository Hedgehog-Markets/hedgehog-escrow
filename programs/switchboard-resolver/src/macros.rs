/// Returns the bump seed for a given account.
macro_rules! get_bump {
    ($ctx:ident, $account:ident) => {{
        // Hint to IDE for code completion.
        let _ = || ::std::ptr::addr_of!($ctx.accounts.$account);

        let bump: Option<u8> = $ctx.bumps.get(stringify!($account)).copied();
        bump.ok_or_else(|| anchor_lang::error!($crate::error::ErrorCode::NonCanonicalBump))
            .map_err(|err| err.with_account_name(stringify!($account)))
    }};
}
