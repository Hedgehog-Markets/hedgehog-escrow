use anchor_lang::prelude::*;
use solana_program::entrypoint::ProgramResult;

use crate::error::ErrorCode;
use crate::state::{Market, Outcome};

#[derive(Clone, AnchorDeserialize, AnchorSerialize)]
pub struct UpdateStateParams {
    pub outcome: Outcome,
}

#[derive(Accounts)]
#[instruction(params: UpdateStateParams)]
pub struct UpdateState<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    pub resolver: Signer<'info>,
}

impl UpdateState<'_> {
    /// Legal updates:
    /// - Before the expiry ts:
    ///   - Open => Invalid, Invalid => Open (latter resets outcome_ts to 0)
    /// - After the expiry ts:
    ///   - Cannot return to Open.
    ///
    /// Finalization checks should occur before this check.
    pub fn can_update(&self, now: u64, outcome: Outcome) -> Result<()> {
        if *self.resolver.key != self.market.resolver {
            return Err(error!(ErrorCode::IncorrectResolver));
        }

        if now < self.market.expiry_ts {
            let legal_transition = match self.market.outcome {
                Outcome::Open => matches!(outcome, Outcome::Invalid),
                Outcome::Yes => false,
                Outcome::No => false,
                Outcome::Invalid => matches!(outcome, Outcome::Open),
            };

            if legal_transition {
                return Ok(());
            }

            return Err(error!(ErrorCode::InvalidTransition));
        }

        if outcome == Outcome::Open {
            return Err(error!(ErrorCode::InvalidTransition));
        }

        Ok(())
    }
}

pub fn handler(ctx: Context<UpdateState>, params: UpdateStateParams) -> ProgramResult {
    let UpdateStateParams { outcome } = params;
    let now = Clock::get()?.unix_timestamp as u64;
    let is_finalized = ctx.accounts.market.finalize(now)?;

    // If auto-finalize is true, we can exit early. Note that anyone can trigger
    // an auto-finalize, even if they are not the marked resolver.
    if is_finalized {
        return Ok(());
    }

    // If not finalized, we can set updates if we are past the expiry timestamp.
    // At this point we should check that the resolver is the correct one.
    ctx.accounts.can_update(now, outcome)?;
    // ctx.accounts.market.can_update(ctx.accounts.resolver.key, now, outcome)?;

    let market = &mut ctx.accounts.market;
    if outcome == Outcome::Open {
        market.outcome_ts = 0;
    } else {
        market.outcome_ts = now;
    }
    market.outcome = outcome;

    Ok(())
}
