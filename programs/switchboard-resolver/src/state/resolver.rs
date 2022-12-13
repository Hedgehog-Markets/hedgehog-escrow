use anchor_lang::prelude::*;
use solana_program::pubkey::PUBKEY_BYTES;

/// Seed used to derive the [`Resolver`] PDA.
pub const RESOLVER_SEED: &[u8] = b"resolver";

/// Metadata account for resolving a market based on a Switchboard feed.
#[account]
#[derive(Default)]
pub struct Resolver {
    /// The market to be resolved.
    pub market: Pubkey,
    /// The Switchboard feed to use to resolve.
    pub feed: Pubkey,
}

impl Resolver {
    pub const LEN: usize = {
        PUBKEY_BYTES // market
        + PUBKEY_BYTES // feed
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_size() {
        let expected = Resolver::LEN;

        let account = Resolver::default();
        let mut buf = Vec::with_capacity(expected);
        AnchorSerialize::serialize(&account, &mut buf).unwrap();

        assert_eq!(expected, buf.len());
    }
}
