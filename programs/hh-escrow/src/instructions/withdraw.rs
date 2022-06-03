use anchor_lang::prelude::*;
use anchor_spl::token::Token;
use solana_program::entrypoint::ProgramResult;

use common::traits::KeyRef;

use crate::error::ErrorCode;
use crate::state::{Market, Outcome, UserPosition};
use crate::utils::signer_transfer;

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub user: Signer<'info>,
    /// CHECK: We do not read any data from this account. The correctness of the
    /// account is checked by the constraint on the market account. Writes
    /// only occur via the token program, which performs necessary checks on
    /// sufficient balance and matching token mints.
    #[account(mut)]
    pub yes_token_account: UncheckedAccount<'info>,
    /// CHECK: We do not read any data from this account. The correctness of the
    /// account is checked by the constraint on the market account. Writes
    /// only occur via the token program, which performs necessary checks on
    /// sufficient balance and matching token mints.
    #[account(mut)]
    pub no_token_account: UncheckedAccount<'info>,
    /// CHECK: We do not read any data from this account. Writes only occur via
    /// the token program, which performs necessary checks on sufficient balance
    /// and matching token mints.
    #[account(mut)]
    pub user_token_account: UncheckedAccount<'info>,
    /// CHECK: We do not read/write any data from this account.
    #[account(seeds = [b"authority", market.key_ref().as_ref()], bump)]
    pub authority: AccountInfo<'info>,
    #[account(
        constraint = market.outcome == Outcome::Invalid @ ErrorCode::MarketNotInvalid,
        has_one = yes_token_account @ ErrorCode::IncorrectYesEscrow,
        has_one = no_token_account @ ErrorCode::IncorrectNoEscrow,
    )]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [b"user", user.key_ref().as_ref(), market.key_ref().as_ref()], bump)]
    pub user_position: Account<'info, UserPosition>,
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
                &ctx.accounts.user_token_account,
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
            &ctx.accounts.user_token_account,
            &ctx.accounts.authority,
            &[signer],
            no_withdraw,
        )
    }, bump_seed)?;

    Ok(())
}
