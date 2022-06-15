use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use solana_program::entrypoint::ProgramResult;
use spl_associated_token_account::get_associated_token_address;

use common::traits::KeyRef;

use crate::error::ErrorCode;
use crate::state::{GlobalState, Market, Outcome, UserPosition};
use crate::utils::signer_transfer;

/// Allows users to claim their winnings.
#[derive(Accounts)]
pub struct Claim<'info> {
    /// The global state account.
    #[account(seeds = [b"global"], bump)]
    pub global_state: Account<'info, GlobalState>,
    /// The fee account that receive protocol fees.
    #[account(
        mut,
        constraint = fee_account.owner == global_state.fee_wallet @ ErrorCode::AccountNotOwnedByFeeWallet,
    )]
    pub fee_account: Account<'info, TokenAccount>,
    /// The user's token account. We explicitly check the owner for this
    /// account.
    #[account(mut,
        constraint = user_token_account.key_ref() != yes_token_account.key_ref() && user_token_account.key_ref() != no_token_account.key_ref() @ ErrorCode::UserAccountCannotBeMarketAccount,
        constraint = user_token_account.owner == *user.key_ref() @ ErrorCode::UserAccountIncorrectOwner
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    /// Escrow for tokens on the yes side of the market.
    ///
    /// CHECK: We do not read any data from this account. The correctness of the
    /// account is checked by the constraint on the market account . Writes
    /// only occur via the token program, which performs necessary checks on
    /// sufficient balance and matching token mints.
    #[account(mut)]
    pub yes_token_account: AccountInfo<'info>,
    /// Escrow for tokens on the no side of the market.
    ///
    /// CHECK: We do not read any data from this account. The correctness of the
    /// account is checked by the constraint on the market account. Writes
    /// only occur via the token program, which performs necessary checks on
    /// sufficient balance and matching token mints.
    #[account(mut)]
    pub no_token_account: AccountInfo<'info>,
    /// The user's [UserPosition] account.
    #[account(
        mut,
        seeds = [b"user", user.key_ref().as_ref(), market.key_ref().as_ref()],
        bump
    )]
    pub user_position: Account<'info, UserPosition>,
    /// The [Market] to claim winnings for.
    #[account(
        mut,
        has_one = yes_token_account @ ErrorCode::IncorrectYesEscrow,
        has_one = no_token_account @ ErrorCode::IncorrectNoEscrow,
    )]
    pub market: Box<Account<'info, Market>>,
    /// The authority for the market token accounts.
    ///
    /// CHECK: We do not read/write any data from this account.
    #[account(seeds = [b"authority", market.key_ref().as_ref()], bump)]
    pub authority: AccountInfo<'info>,
    /// The SPL Token program.
    pub token_program: Program<'info, Token>,
    /// The user claiming winnings.
    pub user: Signer<'info>,
}

impl Claim<'_> {
    pub fn can_claim(&mut self) -> Result<()> {
        // Check that the provided fee token account is the associated token
        // account of the fee wallet.
        let key =
            get_associated_token_address(&self.global_state.fee_wallet, &self.market.token_mint);
        if key != *self.fee_account.key_ref() {
            return Err(error!(ErrorCode::AssociatedTokenAccountRequired));
        }

        let now = Clock::get()?.unix_timestamp as u64;
        if !self.market.finalize(now)? {
            return Err(error!(ErrorCode::NotFinalized));
        }

        if self.market.outcome == Outcome::Invalid || self.market.outcome == Outcome::Open {
            return Err(error!(ErrorCode::CannotClaim));
        }

        Ok(())
    }

    /// Calls the given function with the signer seeds.
    fn with_signer_seeds<F, R>(&self, f: F, bump: u8) -> R
    where
        F: Fn(&[&[u8]]) -> R,
    {
        let market_key = self.market.key_ref();
        let seeds = [b"authority", market_key.as_ref(), &[bump]];

        f(&seeds)
    }
}

pub fn handler(ctx: Context<Claim>) -> ProgramResult {
    ctx.accounts.can_claim()?;

    let user_position = &ctx.accounts.user_position;
    let market = &ctx.accounts.market;

    // Compute the winnings.
    let (winning_num, winning_denom, pool, winning_side_holdings, losing_side_holdings) =
        match ctx.accounts.market.outcome {
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
            _ => unreachable!(),
        };

    // Reset the user position.
    let user_position = &mut ctx.accounts.user_position;
    user_position.yes_amount = 0;
    user_position.no_amount = 0;

    // If the winning side was 0 we can exit early.
    if winning_num == 0 {
        return Ok(());
    }

    // Both numbers are u64, so this should not overflow. Morever, num / denom *
    // pool <= pool, so the cast to u64 should not lose information beyond any
    // fractional portion of the division.
    let winnings = (((winning_num as u128) * (pool as u128)) / (winning_denom as u128)) as u64;

    // Fees.
    let fee = ctx.accounts.global_state.fee_cut_bps.fee(winnings);

    // Clip remaining winnings to 0.
    let remaining_winnings = match winnings.checked_sub(fee) {
        Some(x) => x,
        None => 0,
    };

    // Transfer.
    let bump_seed = *ctx
        .bumps
        .get("authority")
        .ok_or_else(|| error!(ErrorCode::NonCanonicalBumpSeed))?;

    ctx.accounts.with_signer_seeds(
        |signer| {
            // Fee to the fee wallet.
            signer_transfer(
                &ctx.accounts.token_program,
                &losing_side_holdings,
                &ctx.accounts.fee_account.to_account_info(),
                &ctx.accounts.authority,
                &[signer],
                fee,
            )?;

            // Winnings to the user's wallet.
            signer_transfer(
                &ctx.accounts.token_program,
                &losing_side_holdings,
                &ctx.accounts.user_token_account.to_account_info(),
                &ctx.accounts.authority,
                &[signer],
                remaining_winnings,
            )?;

            // Original position to the user's wallet.
            signer_transfer(
                &ctx.accounts.token_program,
                &winning_side_holdings,
                &ctx.accounts.user_token_account.to_account_info(),
                &ctx.accounts.authority,
                &[signer],
                winning_num,
            )

        },
        bump_seed,
    )?;

    Ok(())
}
