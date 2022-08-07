use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use common::traits::KeyRef;

use crate::error::ErrorCode;
use crate::state::{GlobalState, Market, Outcome, UserPosition};
use crate::utils::{self, to_u128, to_u64};

/// Allows users to claim their winnings.
#[derive(Accounts)]
pub struct Claim<'info> {
    /// The market to claim winnings for.
    #[account(mut)]
    pub market: Box<Account<'info, Market>>,
    /// The user claiming winnings.
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
    /// The fee account that receive protocol fees.
    #[account(
        mut,
        associated_token::mint = market.token_mint,
        associated_token::authority = global_state.fee_wallet,
    )]
    pub fee_account: Account<'info, TokenAccount>,
    /// The authority for the market token accounts.
    ///
    /// CHECK: We do not read/write any data from this account.
    #[account(seeds = [b"authority", market.key_ref().as_ref()], bump)]
    pub authority: AccountInfo<'info>,

    /// The global state account.
    #[account(seeds = [b"global"], bump)]
    pub global_state: Account<'info, GlobalState>,

    /// The SPL Token program.
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Claim>) -> Result<()> {
    if !ctx.accounts.market.is_finalized()? {
        return Err(error!(ErrorCode::NotFinalized));
    }

    let user_position = &mut ctx.accounts.user_position;
    let market = &ctx.accounts.market;

    let (winning_numer, winning_denom, pool, winning_holdings, losing_holdings) =
        match market.outcome {
            Outcome::Yes => (
                user_position.yes_amount,
                market.yes_amount,
                market.no_amount,
                &ctx.accounts.yes_token_account,
                &ctx.accounts.no_token_account,
            ),
            Outcome::No => (
                user_position.no_amount,
                market.no_amount,
                market.yes_amount,
                &ctx.accounts.no_token_account,
                &ctx.accounts.yes_token_account,
            ),
            Outcome::Invalid | Outcome::Open => return Err(error!(ErrorCode::CannotClaim)),
        };

    // Reset the user position.
    user_position.yes_amount = 0;
    user_position.no_amount = 0;

    // If the winning side was 0 we can exit early.
    if winning_numer == 0 {
        return Ok(());
    }

    // Compute winnings.
    let winnings = {
        #[inline]
        fn compute_winnings(winning_num: u128, winning_denom: u128, pool: u128) -> Option<u128> {
            pool.checked_mul(winning_num)?.checked_div(winning_denom)
        }

        to_u64(
            compute_winnings(
                to_u128(winning_numer)?,
                to_u128(winning_denom)?,
                to_u128(pool)?,
            )
            .ok_or_else(|| error!(ErrorCode::CalculationFailure))?,
        )?
    };

    // Compute fees.
    let fee = ctx.accounts.global_state.protocol_fee_bps.fee(winnings);
    // Take fee from winnings.
    let remaining_winnings = winnings.saturating_sub(fee);

    let bump = get_bump!(ctx, authority)?;
    let signer_seeds = &[
        b"authority",
        ctx.accounts.market.key_ref().as_ref(),
        &[bump],
    ];

    // Transfer fee to the fee wallet.
    utils::signer_transfer(
        &ctx.accounts.token_program,
        losing_holdings,
        ctx.accounts.fee_account.as_ref(),
        &ctx.accounts.authority,
        &[signer_seeds],
        fee,
    )?;

    // Transfer winnings to the user wallet.
    utils::signer_transfer(
        &ctx.accounts.token_program,
        losing_holdings,
        ctx.accounts.user_token_account.as_ref(),
        &ctx.accounts.authority,
        &[signer_seeds],
        remaining_winnings,
    )?;

    // Transfer original position to the user wallet.
    utils::signer_transfer(
        &ctx.accounts.token_program,
        winning_holdings,
        ctx.accounts.user_token_account.as_ref(),
        &ctx.accounts.authority,
        &[signer_seeds],
        winning_numer,
    )?;

    Ok(())
}
