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
    /// The Market account.
    #[account(mut)]
    pub market: Account<'info, Market>,
    /// The user withdrawing funds.
    pub user: Signer<'info>,
    /// The user's position for this market.
    #[account(mut, seeds = [b"user", user.key_ref().as_ref(), market.key_ref().as_ref()], bump)]
    pub user_position: Account<'info, UserPosition>,
    /// The user's token account.
    ///
    /// We explicitly check the owner for this account.
    #[account(
        mut,
        constraint = user_token_account.key_ref() != yes_token_account.key_ref() && user_token_account.key_ref() != no_token_account.key_ref() @ ErrorCode::UserAccountCannotBeMarketAccount,
        constraint = user_token_account.owner == *user.key_ref() @ ErrorCode::UserAccountIncorrectOwner,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    /// Escrow for tokens on the yes side of the market.
    ///
    /// CHECK: Reads and writes only occur via the token program, which
    /// performs necessary checks.
    #[account(mut, address = market.yes_token_account @ ErrorCode::IncorrectYesEscrow)]
    pub yes_token_account: UncheckedAccount<'info>,
    /// Escrow for tokens on the no side of the market.
    ///
    /// CHECK: Reads and writes only occur via the token program, which
    /// performs necessary checks.
    #[account(mut, address = market.no_token_account @ ErrorCode::IncorrectNoEscrow)]
    pub no_token_account: UncheckedAccount<'info>,
    /// The authority for the market token accounts.
    ///
    /// CHECK: We do not read/write any data from this account.
    #[account(seeds = [b"authority", market.key_ref().as_ref()], bump)]
    pub authority: AccountInfo<'info>,

    /// The SPL Token Program.
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Withdraw>) -> Result<()> {
    // Check that the market is finalized.
    if !ctx.accounts.market.is_finalized()? {
        return Err(error!(ErrorCode::NotFinalized));
    }
    // Check that the outcome is invalid.
    // Note that this may be true if the market just auto-finalized.
    if ctx.accounts.market.outcome != Outcome::Invalid {
        return Err(error!(ErrorCode::MarketNotInvalid));
    }

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
