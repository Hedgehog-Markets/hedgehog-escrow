use anchor_lang::prelude::*;

use crate::state::{Outcome, UriResource};
use crate::error::ErrorCode;

/// 30 days max delay before a result is set.
pub const MAX_DELAY_SEC: u32 = 86_400 * 30;

/// The [Market] account.
#[account]
#[derive(Default)]
pub struct Market {
    /// Creator of the market.
    pub creator: Pubkey,
    /// Resolver for the market.
    pub resolver: Pubkey,
    /// The token this market is denominated in.
    pub token_mint: Pubkey,
    /// The token account to escrow tokens placed on the yes side.
    pub yes_token_account: Pubkey,
    /// The token account to escrow tokens placed on the no side.
    pub no_token_account: Pubkey,
    /// The amount of tokens to fill the yes side.
    pub yes_amount: u64,
    /// The amount of tokens placed on the yes side.
    pub yes_filled: u64,
    /// The amount of tokens to fill the no side.
    pub no_amount: u64,
    /// The amount of tokens placed on the no side.
    pub no_filled: u64,
    /// The timestamp at which the market closes (i.e. does not accept new
    /// funds).
    pub close_ts: u64,
    /// The timestamp at which the market can be resolved.
    pub expiry_ts: u64,
    /// The timestamp of when a market has been set to an outcome. 0 if not set.
    pub outcome_ts: u64,
    /// The delay in seconds before the outcome is finalized.
    pub resolution_delay: u32,
    /// The outcome of the market.
    pub outcome: Outcome,
    /// A flag checking whether the market is finalized.
    pub finalized: bool,
    /// The bump seed for the yes token account.
    pub yes_account_bump: u8,
    /// The bump seed for the no token account.
    pub no_account_bump: u8,
    /// The URI to the market's info (i.e. title, description)
    pub uri: UriResource,
}

impl Market {
    pub const LEN: usize = 5 * 32 + 7 * 8 + 4 + 1 + 1 + 2 * 1 + UriResource::LEN;

    /// Checks whether the market is finalized. If the `finalized` flag is not
    /// flipped, checks conditions that would cause the market to be finalized,
    /// and flips the flag if needed.
    pub fn finalize(&mut self, now: u64) -> Result<bool> {
        // Already finalized.
        if self.finalized {
            return Ok(true);
        }

        // Failed to fill funds.
        if (self.yes_filled < self.yes_amount || self.no_filled < self.no_amount)
            && now >= self.close_ts
        {
            self.finalized = true;
            self.outcome = Outcome::Invalid;
            return Ok(true);
        }

        // Beyond MAX_DELAY_SEC of the expiry.
        if now
            >= self
                .expiry_ts
                .checked_add(MAX_DELAY_SEC.into())
                .ok_or(ErrorCode::Overflow)?
        {
            if self.outcome == Outcome::Open {
                self.outcome = Outcome::Invalid;
            }
            self.finalized = true;
            return Ok(true);
        }

        // Beyond resolution delay of the outcome.
        if self.outcome != Outcome::Open
            && now
                >= self
                    .outcome_ts
                    .checked_add(self.resolution_delay.into())
                    .ok_or(ErrorCode::Overflow)?
        {
            self.finalized = true;
            return Ok(true);
        }

        Ok(false)
    }

    /// Same as `is_and_set_finalize`, but errors if the market is finalized.
    /// 
    /// Note that this is slightly inefficient, as this will cause the
    /// transaction to fail and revert writes that occur from
    /// `is_and_set_finalize`. However, this should be called at the beginning
    /// of any transaction that needs this check, so any wasted compute is
    /// minimal.
    pub fn set_and_check_finalize(&mut self, now: u64) -> Result<()> {
        if self.finalize(now)? {
            return Err(error!(ErrorCode::AlreadyFinalized));
        }

        Ok(())
    }
}

// TODO: Mock the Clock implementation.
// Tests for finalize logic with a mocked timestamp.
#[cfg(test)]
mod tests {
    use super::*;

    // Checks that we return true if the finalized boolean is set to true.
    #[test]
    fn check_finalized_boolean() {
        let mut market = Market {
            finalized: true,
            ..Default::default()
        };

        let result = market.finalize(0).unwrap();

        assert_eq!(result, true);
    }

    // Check that we finalize the market if it fails to fill all its funds for
    // the yes account.
    #[test]
    fn check_finalized_unfunded_yes() {
        let mut market = Market {
            yes_amount: 10,
            yes_filled: 9,
            ..Default::default()
        };

        let result = market.finalize(0).unwrap();

        assert_eq!(result, true);
        assert_eq!(market.finalized, true);
        assert_eq!(market.outcome, Outcome::Invalid);
    }

    // Check that we finalize the market if it fails to fill all its funds for
    // the no account.
    #[test]
    fn check_finalized_unfunded_no() {
        let mut market = Market {
            no_amount: 10,
            no_filled: 9,
            ..Default::default()
        };

        let result = market.finalize(0).unwrap();

        assert_eq!(result, true);
        assert_eq!(market.finalized, true);
        assert_eq!(market.outcome, Outcome::Invalid);
    }

    // Check that we finalize the market and set the outcome to invalid if we
    // fail to set any outcome before the max delay passes.
    #[test]
    fn check_finalized_max_delay_invalid() {
        let mut market = Market {
            resolution_delay: MAX_DELAY_SEC + 1,
            ..Default::default()
        };

        let result = market.finalize(MAX_DELAY_SEC.into()).unwrap();

        assert_eq!(result, true);
        assert_eq!(market.finalized, true);
        assert_eq!(market.outcome_ts, 0);
        assert_eq!(market.outcome, Outcome::Invalid);
    }

    // Check that we finalize the market to the given outcome if we've passed
    // the maximum delay allowed from the expiry time.
    #[test]
    fn check_finalized_max_delay_valid() {
        let mut market = Market {
            resolution_delay: MAX_DELAY_SEC + 2,
            outcome_ts: 1,
            outcome: Outcome::Yes,
            ..Default::default()
        };

        let result = market.finalize(MAX_DELAY_SEC.into()).unwrap();

        assert_eq!(result, true);
        assert_eq!(market.finalized, true);
        assert_eq!(market.outcome, Outcome::Yes);
    }

    // Check that we finalize the market to the given outcome if we've passed
    // the resolution delay from when the outcome was set.
    #[test]
    fn check_finalized_resolution_delay() {
        let mut market = Market {
            resolution_delay: 10,
            outcome_ts: (MAX_DELAY_SEC - 20).into(),
            expiry_ts: 5,
            outcome: Outcome::Yes,
            ..Default::default()
        };

        let result = market
            .finalize((MAX_DELAY_SEC - 10).into())
            .unwrap();

        assert_eq!(result, true);
        assert_eq!(market.finalized, true);
        assert_eq!(market.outcome, Outcome::Yes);
    }
}
