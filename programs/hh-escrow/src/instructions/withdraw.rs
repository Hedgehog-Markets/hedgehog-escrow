use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use common::traits::KeyRef;

use crate::error::ErrorCode;
use crate::state::{Market, Outcome, UserPosition};
use crate::utils;

/// Allows the user to withdraw from a finalized, invalid Market.
///
/// If the market can be auto-finalized, this instruction can do so without a
/// call to [UpdateStatus].
#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// The user withdrawing funds.
    pub user: Signer<'info>,
    /// The yes token account for the market.
    ///
    /// CHECK: We do not read any data from this account. The correctness of the
    /// account is checked by the constraint on the market account. Writes
    /// only occur via the token program, which performs necessary checks on
    /// sufficient balance and matching token mints.
    #[account(mut)]
    pub yes_token_account: UncheckedAccount<'info>,
    /// The no token account for the market.
    ///
    /// CHECK: We do not read any data from this account. The correctness of the
    /// account is checked by the constraint on the market account. Writes
    /// only occur via the token program, which performs necessary checks on
    /// sufficient balance and matching token mints.
    #[account(mut)]
    pub no_token_account: UncheckedAccount<'info>,
    /// The user's token account. We explicitly check the owner for this
    /// account.
    #[account(mut,
        constraint = user_token_account.key_ref() != yes_token_account.key_ref() && user_token_account.key_ref() != no_token_account.key_ref() @ ErrorCode::UserAccountCannotBeMarketAccount,
        constraint = user_token_account.owner == *user.key_ref() @ ErrorCode::UserAccountIncorrectOwner
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    /// The authority for the market token accounts.
    ///
    /// CHECK: We do not read/write any data from this account.
    #[account(seeds = [b"authority", market.key_ref().as_ref()], bump)]
    pub authority: AccountInfo<'info>,
    /// The Market account.
    #[account(
        mut,
        constraint = market.outcome == Outcome::Invalid @ ErrorCode::MarketNotInvalid,
        has_one = yes_token_account @ ErrorCode::IncorrectYesEscrow,
        has_one = no_token_account @ ErrorCode::IncorrectNoEscrow,
    )]
    pub market: Account<'info, Market>,
    /// The user's [UserPosition] account for this market.
    #[account(mut, seeds = [b"user", user.key_ref().as_ref(), market.key_ref().as_ref()], bump)]
    pub user_position: Account<'info, UserPosition>,
    /// The SPL Token Program.
    pub token_program: Program<'info, Token>,
}

impl Withdraw<'_> {
    /// Verify that the market is finalized.
    fn verify_finalized(&mut self) -> Result<()> {
        if !self.market.is_finalized()? {
            return Err(error!(ErrorCode::NotFinalized));
        }
        Ok(())
    }
}

pub fn handler(ctx: Context<Withdraw>) -> Result<()> {
    // Check that the market is finalized.
    ctx.accounts.verify_finalized()?;

    let (yes_withdraw, no_withdraw) = {
        let user_position = &mut ctx.accounts.user_position;

        let yes_withdraw = user_position.yes_amount;
        let no_withdraw = user_position.no_amount;

        // Reset the user position.
        user_position.yes_amount = 0;
        user_position.no_amount = 0;

        (yes_withdraw, no_withdraw)
    };

    let bump = get_bump!(ctx, authority)?;
    let signer_seeds = &[
        b"authority",
        ctx.accounts.market.key_ref().as_ref(),
        &[bump],
    ];

    // Transfer original yes position to the user wallet.
    utils::signer_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.yes_token_account,
        ctx.accounts.user_token_account.as_ref(),
        &ctx.accounts.authority,
        &[signer_seeds],
        yes_withdraw,
    )?;

    // Transfer original no position to the user wallet.
    utils::signer_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.no_token_account,
        ctx.accounts.user_token_account.as_ref(),
        &ctx.accounts.authority,
        &[signer_seeds],
        no_withdraw,
    )?;

    Ok(())
}
