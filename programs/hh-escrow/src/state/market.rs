use anchor_lang::prelude::*;
use solana_program::pubkey::PUBKEY_BYTES;

use crate::error::ErrorCode;
use crate::state::{Outcome, UriResource};
use crate::utils;

/// 30 days max resolution delay.
pub const MAX_DELAY: u32 = 30 * 86_400;

/// Market metadata account.
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
    /// Whether the resolver has acknowledged this market.
    pub acknowledged: bool,
    /// The URI to the market info (i.e. title, description)
    pub uri: UriResource,
}

impl Market {
    #[allow(clippy::identity_op)]
    pub const LEN: usize =
        (5 * PUBKEY_BYTES) + (7 * 8) + 4 + Outcome::LEN + 1 + (2 * 1) + 1 + UriResource::LEN;

    fn check_finalized(&mut self, now: u64) -> Result<bool> {
        // Failed to fill funds.
        if (self.yes_filled < self.yes_amount || self.no_filled < self.no_amount)
            && now >= self.close_ts
        {
            self.finalized = true;
            self.outcome = Outcome::Invalid;
            return Ok(true);
        }

        // Beyond MAX_DELAY of the expiry.
        if now
            >= self
                .expiry_ts
                .checked_add(MAX_DELAY.into())
                .ok_or_else(|| error!(ErrorCode::CalculationFailure))?
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
                    .ok_or_else(|| error!(ErrorCode::CalculationFailure))?
        {
            self.finalized = true;
            return Ok(true);
        }

        Ok(false)
    }

    /// Checks whether the market is finalized, additionally returning the
    /// timestamp used in the check.
    ///
    /// If the `finalized` flag is not set, checks the conditions that would
    /// cause the market to be finalized and sets the flag if `true`.
    pub fn is_finalized_and_ts(&mut self) -> Result<(bool, u64)> {
        let now = utils::unix_timestamp()?;

        // Already finalized.
        if self.finalized {
            return Ok((true, now));
        }

        Ok((self.check_finalized(now)?, now))
    }

    /// Checks whether the market is finalized.
    ///
    /// If the `finalized` flag is not set, checks the conditions that would
    /// cause the market to be finalized and sets the flag if `true`.
    pub fn is_finalized(&mut self) -> Result<bool> {
        // Already finalized.
        if self.finalized {
            return Ok(true);
        }

        let now = utils::unix_timestamp()?;

        self.check_finalized(now)
    }

    /// Attempts to mark the market as finalized, failing if the market is
    /// already finalized.
    pub fn finalize(&mut self) -> Result<()> {
        if self.is_finalized()? {
            return Err(error!(ErrorCode::AlreadyFinalized));
        }

        Ok(())
    }
}

// Tests for finalize logic with a mocked timestamp.
#[cfg(test)]
mod tests {
    use super::*;

    const MAX_DELAY_U64: u64 = MAX_DELAY as u64;

    // Checks that we return true if the finalized boolean is set to true.
    #[test]
    fn check_finalized_boolean() {
        let mut market = Market {
            finalized: true,
            ..Default::default()
        };

        utils::mock::timestamp(0);

        assert!(market.is_finalized().unwrap());
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

        utils::mock::timestamp(0);

        assert!(market.is_finalized().unwrap());

        assert!(market.finalized);
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

        utils::mock::timestamp(0);

        assert!(market.is_finalized().unwrap());

        assert!(market.finalized);
        assert_eq!(market.outcome, Outcome::Invalid);
    }

    // Check that we finalize the market and set the outcome to invalid if we
    // fail to set any outcome before the max delay passes.
    #[test]
    fn check_finalized_max_delay_invalid() {
        let mut market = Market {
            resolution_delay: MAX_DELAY + 1,
            ..Default::default()
        };

        utils::mock::timestamp(MAX_DELAY_U64);

        assert!(market.is_finalized().unwrap());

        assert!(market.finalized);
        assert_eq!(market.outcome_ts, 0);
        assert_eq!(market.outcome, Outcome::Invalid);
    }

    // Check that we finalize the market to the given outcome if we've passed
    // the maximum delay allowed from the expiry time.
    #[test]
    fn check_finalized_max_delay_valid() {
        let mut market = Market {
            resolution_delay: MAX_DELAY + 2,
            outcome_ts: 1,
            outcome: Outcome::Yes,
            ..Default::default()
        };

        utils::mock::timestamp(MAX_DELAY_U64);

        assert!(market.is_finalized().unwrap());

        assert!(market.finalized);
        assert_eq!(market.outcome, Outcome::Yes);
    }

    // Check that we finalize the market to the given outcome if we've passed
    // the resolution delay from when the outcome was set.
    #[test]
    fn check_finalized_resolution_delay() {
        let mut market = Market {
            resolution_delay: 10,
            outcome_ts: (MAX_DELAY - 20).into(),
            expiry_ts: 5,
            outcome: Outcome::Yes,
            ..Default::default()
        };

        utils::mock::timestamp(MAX_DELAY_U64 - 10);

        assert!(market.is_finalized().unwrap());

        assert!(market.finalized);
        assert_eq!(market.outcome, Outcome::Yes);
    }
}
