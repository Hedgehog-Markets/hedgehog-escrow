use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use solana_program::entrypoint::ProgramResult;

use common::traits::KeyRef;

use crate::error::ErrorCode;
use crate::state::{Market, UriResource};

/// Parameters for initializing a market.
#[derive(Clone, AnchorDeserialize, AnchorSerialize)]
pub struct InitializeMarketParams {
    /// Set the close time for this market.
    close_ts: u64,
    /// Sets the expiry time.
    expiry_ts: u64,
    /// Amount of seconds to wait until a resolution is final.
    resolution_delay: u32,
    /// The amount of tokens to put on the yes side of the market.
    yes_amount: u64,
    /// The amount of tokens to put on the no side of the market.
    no_amount: u64,
    /// The resolver for this market.
    resolver: Pubkey,
    /// The URI that leads to the market info.
    uri: String,
}

/// Initializes a [`Market`].
///
/// Additionally initializes two token accounts to hold tokens in escrow.
#[derive(Accounts)]
#[instruction(params: InitializeMarketParams)]
pub struct InitializeMarket<'info> {
    /// The market account to initialize.
    #[account(init, payer = creator, space = 8 + Market::LEN)]
    pub market: Account<'info, Market>,
    /// The authority for the two token accounts.
    ///
    /// CHECK: We do not read/write any data from this account.
    #[account(seeds = [b"authority", market.key_ref().as_ref()], bump)]
    pub authority: AccountInfo<'info>,
    /// The creator for the market.
    #[account(mut)]
    pub creator: Signer<'info>,
    /// The token that this market is denominated in.
    pub token_mint: Box<Account<'info, Mint>>,
    /// Escrow for tokens on the yes side of the market.
    #[account(
        init,
        payer = creator,
        token::mint = token_mint,
        token::authority = authority,
        seeds = [b"yes", market.key_ref().as_ref()],
        bump,
    )]
    pub yes_token_account: Account<'info, TokenAccount>,
    /// Escrow for tokens on the no side of the market.
    #[account(
        init,
        payer = creator,
        token::mint = token_mint,
        token::authority = authority,
        seeds = [b"no", market.key_ref().as_ref()],
        bump,
    )]
    pub no_token_account: Account<'info, TokenAccount>,
    /// The Solana System Program.
    pub system_program: Program<'info, System>,
    /// The SPL Token Program.
    pub token_program: Program<'info, Token>,
    /// The Sysvar rent.
    pub rent: Sysvar<'info, Rent>,
}

impl InitializeMarket<'_> {
    pub fn validate_ts(&self, close_ts: u64, expiry_ts: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp as u64;
        if close_ts < now {
            return Err(ErrorCode::InvalidCloseTimestamp.into());
        }
        if expiry_ts < close_ts {
            return Err(ErrorCode::InvalidExpiryTimestamp.into());
        }

        Ok(())
    }
}

pub fn handler(ctx: Context<InitializeMarket>, params: InitializeMarketParams) -> ProgramResult {
    let InitializeMarketParams {
        close_ts,
        expiry_ts,
        resolution_delay,
        uri,
        yes_amount,
        no_amount,
        resolver,
    } = params;

    // Exit early if timestamps are invalid.
    ctx.accounts.validate_ts(close_ts, expiry_ts)?;

    let market = &mut ctx.accounts.market;

    // Exit early if info is invalid.
    market.uri = UriResource::validate(&uri)?;

    market.creator = ctx.accounts.creator.key();
    market.resolver = resolver.key();
    market.token_mint = ctx.accounts.token_mint.key();
    market.yes_token_account = ctx.accounts.yes_token_account.key();
    market.no_token_account = ctx.accounts.no_token_account.key();
    market.yes_amount = yes_amount;
    market.no_amount = no_amount;
    market.close_ts = close_ts;
    market.expiry_ts = expiry_ts;
    market.outcome_ts = 0;
    market.resolution_delay = resolution_delay;
    market.yes_account_bump = *ctx
        .bumps
        .get("yes_token_account")
        .ok_or(error!(ErrorCode::NonCanonicalBumpSeed))?;
    market.no_account_bump = *ctx
        .bumps
        .get("no_token_account")
        .ok_or(error!(ErrorCode::NonCanonicalBumpSeed))?;

    Ok(())
}
