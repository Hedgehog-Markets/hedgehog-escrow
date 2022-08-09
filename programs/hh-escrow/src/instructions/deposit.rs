use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use common::traits::KeyRef;

use crate::error::ErrorCode;
use crate::state::{Market, UserPosition};
use crate::utils;

/// Parameters for the [Deposit] instruction.
#[derive(Clone, AnchorDeserialize, AnchorSerialize)]
pub struct DepositParams {
    /// The amount to deposit on the yes side.
    yes_amount: u64,
    /// The amount to deposit on the no side.
    no_amount: u64,
    /// If true, the instruction will not fail if the user attempts to fill a
    /// side above the specified amount, but rather fill that side to the max.
    allow_partial: bool,
}

/// Allows a user to deposit into a given market.
#[derive(Accounts)]
#[instruction(params: DepositParams)]
pub struct Deposit<'info> {
    /// The market to deposit into.
    #[account(mut)]
    pub market: Account<'info, Market>,
    /// The user depositing into the market.
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

    /// The SPL token program.
    pub token_program: Program<'info, Token>,
}

impl Deposit<'_> {
    pub fn verify_deposit(
        &mut self,
        yes_deposit: u64,
        no_deposit: u64,
        allow_partial: bool,
    ) -> Result<(u64, u64)> {
        if self.market.close_ts <= utils::unix_timestamp()? {
            return Err(error!(ErrorCode::MarketClosed));
        }
        self.market.finalize()?;

        let yes_remaining = self
            .market
            .yes_amount
            .checked_sub(self.market.yes_filled)
            .ok_or_else(|| error!(ErrorCode::CalculationFailure))?;

        if yes_remaining < yes_deposit && !allow_partial {
            return Err(error!(ErrorCode::OverAllowedAmount));
        }

        let no_remaining = self
            .market
            .no_amount
            .checked_sub(self.market.no_filled)
            .ok_or_else(|| error!(ErrorCode::CalculationFailure))?;

        if no_remaining < no_deposit && !allow_partial {
            return Err(error!(ErrorCode::OverAllowedAmount));
        }

        Ok((yes_remaining.min(yes_deposit), no_remaining.min(no_deposit)))
    }
}

pub fn handler(ctx: Context<Deposit>, params: DepositParams) -> Result<()> {
    let DepositParams {
        yes_amount,
        no_amount,
        allow_partial,
    } = params;

    let (yes_deposit, no_deposit) =
        ctx.accounts
            .verify_deposit(yes_amount, no_amount, allow_partial)?;

    let user_position = &mut ctx.accounts.user_position;
    let market = &mut ctx.accounts.market;

    // Update state.
    user_position.yes_amount = user_position
        .yes_amount
        .checked_add(yes_deposit)
        .ok_or_else(|| error!(ErrorCode::CalculationFailure))?;
    user_position.no_amount = user_position
        .no_amount
        .checked_add(no_deposit)
        .ok_or_else(|| error!(ErrorCode::CalculationFailure))?;
    market.yes_filled = market
        .yes_filled
        .checked_add(yes_deposit)
        .ok_or_else(|| error!(ErrorCode::CalculationFailure))?;
    market.no_filled = market
        .no_filled
        .checked_add(no_deposit)
        .ok_or_else(|| error!(ErrorCode::CalculationFailure))?;

    // Perform the transfers.
    utils::non_signer_transfer(
        &ctx.accounts.token_program,
        ctx.accounts.user_token_account.as_ref(),
        &ctx.accounts.yes_token_account,
        &ctx.accounts.user,
        yes_deposit,
    )?;
    utils::non_signer_transfer(
        &ctx.accounts.token_program,
        ctx.accounts.user_token_account.as_ref(),
        &ctx.accounts.no_token_account,
        &ctx.accounts.user,
        no_deposit,
    )?;

    Ok(())
}
