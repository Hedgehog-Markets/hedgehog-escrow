use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use common::sys;
use common::traits::KeyRef;

use crate::error::ErrorCode;
use crate::state::{Market, Outcome, UriResource};

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
    pub token_mint: Account<'info, Mint>,
    /// Escrow for tokens on the yes side of the market.
    ///
    /// CHECK: We explicitly create this account in the handler.
    #[account(mut, seeds = [b"yes", market.key_ref().as_ref()], bump)]
    pub yes_token_account: UncheckedAccount<'info>,
    /// Escrow for tokens on the no side of the market.
    ///
    /// CHECK: We explicitly create this account in the handler.
    #[account(mut, seeds = [b"no", market.key_ref().as_ref()], bump)]
    pub no_token_account: UncheckedAccount<'info>,

    /// The Solana System Program.
    pub system_program: Program<'info, System>,
    /// The SPL Token Program.
    pub token_program: Program<'info, Token>,
}

impl<'info> InitializeMarket<'info> {
    fn init_token_account(
        &self,
        account: &AccountInfo<'info>,
        signer_seeds: &[&[&[u8]]],
    ) -> Result<()> {
        let payer = &*self.creator;

        let required_lamports = Rent::get()?.minimum_balance(TokenAccount::LEN);
        let lamports = account.lamports();

        if lamports == 0 {
            // Create a new token account.
            solana_program::program::invoke_signed(
                &solana_program::system_instruction::create_account(
                    payer.key,
                    account.key,
                    required_lamports,
                    TokenAccount::LEN as u64,
                    self.token_program.key,
                ),
                &[payer.to_account_info(), account.to_account_info()],
                signer_seeds,
            )?;
        } else {
            let required_lamports = required_lamports.max(1).saturating_sub(lamports);
            if required_lamports > 0 {
                // Top up lamports.
                solana_program::program::invoke(
                    &solana_program::system_instruction::transfer(
                        payer.key,
                        account.key,
                        required_lamports,
                    ),
                    &[payer.to_account_info(), account.to_account_info()],
                )?;
            }

            // Allocate space for the token account.
            solana_program::program::invoke_signed(
                &solana_program::system_instruction::allocate(
                    account.key,
                    TokenAccount::LEN as u64,
                ),
                &[account.to_account_info()],
                signer_seeds,
            )?;

            // Assign the token program as the account owner.
            solana_program::program::invoke_signed(
                &solana_program::system_instruction::assign(account.key, self.token_program.key),
                &[account.to_account_info()],
                signer_seeds,
            )?;
        }

        // Initialize the token account.
        solana_program::program::invoke(
            &spl_token::instruction::initialize_account3(
                self.token_program.key,
                account.key,
                self.token_mint.key_ref(),
                self.authority.key,
            )?,
            &[account.to_account_info(), self.token_mint.to_account_info()],
        )?;

        Ok(())
    }

    fn init_yes_token_account(&self, bump: u8) -> Result<()> {
        self.init_token_account(
            &self.yes_token_account,
            &[&[b"yes", self.market.key_ref().as_ref(), &[bump]]],
        )
    }

    fn init_no_token_account(&self, bump: u8) -> Result<()> {
        self.init_token_account(
            &self.no_token_account,
            &[&[b"no", self.market.key_ref().as_ref(), &[bump]]],
        )
    }
}

pub fn handler(ctx: Context<InitializeMarket>, params: InitializeMarketParams) -> Result<()> {
    let InitializeMarketParams {
        close_ts,
        expiry_ts,
        resolution_delay,
        uri,
        yes_amount,
        no_amount,
        resolver,
    } = params;

    // Exit early if parameters are invalid.
    if yes_amount == 0 || no_amount == 0 {
        return Err(error!(ErrorCode::ZeroTokensToFill));
    }
    if close_ts < sys::timestamp()? {
        return Err(error!(ErrorCode::InvalidCloseTimestamp));
    }
    if expiry_ts < close_ts {
        return Err(error!(ErrorCode::InvalidExpiryTimestamp));
    }

    // Exit early if bump seeds are missing.
    let yes_account_bump = get_bump!(ctx, yes_token_account)?;
    let no_account_bump = get_bump!(ctx, no_token_account)?;

    ctx.accounts.init_yes_token_account(yes_account_bump)?;
    ctx.accounts.init_no_token_account(no_account_bump)?;

    let market = &mut ctx.accounts.market;

    // Exit early if info is invalid.
    market.uri = UriResource::validate(&uri)?;

    market.creator = ctx.accounts.creator.key();
    market.resolver = resolver.key();
    market.token_mint = ctx.accounts.token_mint.key();
    market.yes_token_account = ctx.accounts.yes_token_account.key();
    market.no_token_account = ctx.accounts.no_token_account.key();
    market.yes_amount = yes_amount;
    market.yes_filled = 0;
    market.no_amount = no_amount;
    market.no_filled = 0;
    market.close_ts = close_ts;
    market.expiry_ts = expiry_ts;
    market.outcome_ts = 0;
    market.resolution_delay = resolution_delay;
    market.outcome = Outcome::Open;
    market.finalized = false;
    market.yes_account_bump = yes_account_bump;
    market.no_account_bump = no_account_bump;
    market.acknowledged = false;

    Ok(())
}
