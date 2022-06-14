use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use solana_program::entrypoint::ProgramResult;

use common::traits::KeyRef;

use crate::error::ErrorCode;
use crate::state::{Market, Outcome, UserPosition};
use crate::utils::signer_transfer;

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
    fn is_finalized(&mut self) -> Result<()> {
        let now = Clock::get()?.unix_timestamp as u64;
        let result = self.market.finalize(now)?;
        if !result {
            return Err(error!(ErrorCode::NotFinalized));
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

pub fn handler(ctx: Context<Withdraw>) -> ProgramResult {
    ctx.accounts.is_finalized()?;

    let user_position = &mut ctx.accounts.user_position;
    let yes_withdraw = user_position.yes_amount;
    let no_withdraw = user_position.no_amount;
    user_position.yes_amount = 0;
    user_position.no_amount = 0;

    let bump_seed = *ctx
        .bumps
        .get("authority")
        .ok_or_else(|| error!(ErrorCode::NonCanonicalBumpSeed))?;
    ctx.accounts.with_signer_seeds(
        |signer| {
            signer_transfer(
                &ctx.accounts.token_program,
                &ctx.accounts.yes_token_account,
                &ctx.accounts.user_token_account.to_account_info(),
                &ctx.accounts.authority,
                &[signer],
                yes_withdraw,
            )
        },
        bump_seed,
    )?;
    ctx.accounts.with_signer_seeds(|signer| {
        signer_transfer(
            &ctx.accounts.token_program,
            &ctx.accounts.no_token_account,
            &ctx.accounts.user_token_account.to_account_info(),
            &ctx.accounts.authority,
            &[signer],
            no_withdraw,
        )
    }, bump_seed)?;

    Ok(())
}
