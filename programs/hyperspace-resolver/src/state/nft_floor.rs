use anchor_lang::prelude::*;
use solana_program::pubkey::PUBKEY_BYTES;

/// Seed used to derive the [`NftFloor`] PDA.
pub const NFT_FLOOR_SEED: &[u8] = b"nft_floor";

/// Metadata account for resolving a market based on NFT floor price.
///
/// The market will be resolved to [`Yes`] if the NFT floor price at
/// [`timestamp`] is greater than or equal to [`floor_price`].
///
/// [`Yes`]: hh_escrow::state::Outcome::Yes
/// [`timestamp`]: NftFloor::timestamp
/// [`floor_price`]: NftFloor::floor_price
#[account]
#[derive(Default)]
pub struct NftFloor {
    /// The public key of the resolver authority.
    pub authority: Pubkey,
    /// The market to be resolved.
    pub market: Pubkey,
    /// Whether the resolver has been acknowledged by the authority.
    pub acknowledged: bool,
    /// The floor price in lamports to compare to when resolving.
    pub floor_price: u64,
    /// The project ID of the collection.
    pub project_id: String,
}

impl NftFloor {
    /// Returns the market's creator.
    pub fn account_size(project_id: &str) -> usize {
        PUBKEY_BYTES // authority
        + PUBKEY_BYTES // market
        + 1 // acknowledged
        + 8 // floor_price
        + 4 + project_id.len() // project_id (4 bytes for length + bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_account_size(project_id: impl Into<String>) {
        let project_id = project_id.into();

        let expected = NftFloor::account_size(&project_id);

        let account = NftFloor {
            project_id,
            ..Default::default()
        };
        let mut buf = Vec::with_capacity(expected);
        AnchorSerialize::serialize(&account, &mut buf).unwrap();

        assert_eq!(expected, buf.len());
    }

    #[test]
    fn account_size() {
        test_account_size("");
        test_account_size("foo");
    }

    quickcheck::quickcheck! {
        fn quickcheck_account_size(project_id: String) -> () {
            test_account_size(project_id);
        }
    }
}
