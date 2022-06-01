use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use solana_program::entrypoint::ProgramResult;

use common::traits::KeyRef;

use crate::error::ErrorCode;
use crate::state::{Market, UserPosition};
use crate::utils::non_signer_transfer;

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
    /// The user depositing into the market.
    pub user: Signer<'info>,
    /// The market to deposit into.
    #[account(
        mut,
        has_one = yes_token_account @ ErrorCode::IncorrectYesEscrow,
        has_one = no_token_account @ ErrorCode::IncorrectNoEscrow,
    )]
    pub market: Account<'info, Market>,
    /// Escrow for tokens on the yes side of the market.
    #[account(mut)]
    pub yes_token_account: Account<'info, TokenAccount>,
    /// Escrow for tokens on the no side of the market.
    #[account(mut)]
    pub no_token_account: Account<'info, TokenAccount>,
    /// The user's token account.
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    /// The [UserPosition] account for this user and market.
    #[account(mut, seeds = [b"user", user.key_ref().as_ref(), market.key_ref().as_ref()], bump)]
    pub user_position: Box<Account<'info, UserPosition>>,
    /// The SPL token program.
    pub token_program: Program<'info, Token>,
}

impl Deposit<'_> {
    pub fn can_deposit(
        &mut self,
        yes_amount: u64,
        no_amount: u64,
        allow_partial: bool,
    ) -> Result<(u64, u64)> {
        let now = Clock::get()?.unix_timestamp as u64;
        if self.market.close_ts <= now {
            return Err(error!(ErrorCode::MarketClosed));
        }

        self.market.set_and_check_finalize(now)?;

        // These subtractions should be safe.
        let yes_left = self
            .market
            .yes_amount
            .checked_sub(self.market.yes_filled)
            .ok_or_else(|| error!(ErrorCode::Overflow))?;
        if yes_left < yes_amount && !allow_partial {
            return Err(error!(ErrorCode::OverAllowedAmount));
        }

        let no_left = self
            .market
            .no_amount
            .checked_sub(self.market.no_filled)
            .ok_or_else(|| error!(ErrorCode::Overflow))?;
        if no_left < no_amount && !allow_partial {
            return Err(error!(ErrorCode::OverAllowedAmount));
        }

        Ok((yes_left.min(yes_amount), no_left.min(no_amount)))
    }
}

pub fn handler(ctx: Context<Deposit>, params: DepositParams) -> ProgramResult {
    let DepositParams {
        yes_amount,
        no_amount,
        allow_partial,
    } = params;

    let (yes_to_deposit, no_to_deposit) =
        ctx.accounts
            .can_deposit(yes_amount, no_amount, allow_partial)?;

    // Update the state.
    let user_position = &mut ctx.accounts.user_position;
    let market = &mut ctx.accounts.market;

    // All of these additions should be safe.
    user_position.yes_amount = user_position
        .yes_amount
        .checked_add(yes_to_deposit)
        .ok_or(error!(ErrorCode::Overflow))?;
    user_position.no_amount = user_position
        .no_amount
        .checked_add(no_to_deposit)
        .ok_or(error!(ErrorCode::Overflow))?;
    market.yes_filled = market
        .yes_filled
        .checked_add(yes_to_deposit)
        .ok_or(error!(ErrorCode::Overflow))?;
    market.no_filled = market
        .no_filled
        .checked_add(no_to_deposit)
        .ok_or(error!(ErrorCode::Overflow))?;

    // Perform the transfers.
    non_signer_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.user_token_account,
        &ctx.accounts.yes_token_account,
        &ctx.accounts.user,
        yes_to_deposit,
    )?;
    non_signer_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.user_token_account,
        &ctx.accounts.no_token_account,
        &ctx.accounts.user,
        no_to_deposit,
    )?;

    Ok(())
}
