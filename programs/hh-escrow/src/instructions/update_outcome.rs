use anchor_lang::prelude::*;

use common::traits::KeyRef;

use crate::error::ErrorCode;
use crate::state::{Market, Outcome};

#[derive(Clone, AnchorDeserialize, AnchorSerialize)]
pub struct UpdateOutcomeParams {
    /// The outcome.
    pub outcome: Outcome,
}

#[derive(Accounts)]
#[instruction(params: UpdateOutcomeParams)]
pub struct UpdateOutcome<'info> {
    /// The market to update.
    #[account(mut)]
    pub market: Account<'info, Market>,
    /// The market resolver.
    pub resolver: Signer<'info>,
}

impl UpdateOutcome<'_> {
    /// Verify that the signing resolver is the market resolver.
    fn verify_resolver(&self) -> Result<()> {
        if *self.resolver.key_ref() != self.market.resolver {
            return Err(error!(ErrorCode::IncorrectResolver));
        }
        Ok(())
    }

    /// Verify the that the outcome transition is allowed.
    ///
    /// Returns the `outcome_ts` if the transition is allowed.
    fn verify_transition(&self, now: u64, outcome: Outcome) -> Result<u64> {
        // If the market has not expired yet, we can only transition between an
        // `Invalid` or `Open` outcome.
        if now < self.market.expiry_ts {
            return match self.market.outcome {
                // Transitioning from `Open` to `Invalid` is allowed.
                Outcome::Open if matches!(outcome, Outcome::Invalid) => Ok(now),
                // Transitioning from `Invalid` to `Open` is allowed.
                //
                // This resets the `outcome_ts` to 0.
                Outcome::Invalid if matches!(outcome, Outcome::Open) => Ok(0),
                // Otherwise, the transition is not allowed.
                _ => Err(error!(ErrorCode::InvalidTransition)),
            };
        }

        // The market has expired, so transitioning to `Open` is not allowed.
        if outcome == Outcome::Open {
            return Err(error!(ErrorCode::InvalidTransition));
        }

        Ok(now)
    }
}

pub fn handler(ctx: Context<UpdateOutcome>, params: UpdateOutcomeParams) -> Result<()> {
    let UpdateOutcomeParams { outcome } = params;

    let (is_finalized, now) = ctx.accounts.market.is_finalized_and_ts()?;

    // If finalized, we can exit early.
    //
    // Note that anyone can trigger an auto-finalize, even if they are not the
    // marked resolver.
    if is_finalized {
        return Ok(());
    }

    // Check that the resolver is the correct one.
    ctx.accounts.verify_resolver()?;

    // Verify the outcome transition.
    let outcome_ts = ctx.accounts.verify_transition(now, outcome)?;

    let market = &mut ctx.accounts.market;

    market.outcome_ts = outcome_ts;
    market.outcome = outcome;

    Ok(())
}
