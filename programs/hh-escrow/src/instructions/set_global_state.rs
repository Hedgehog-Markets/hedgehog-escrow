use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::{Bps, GlobalState};

#[derive(Clone, AnchorDeserialize, AnchorSerialize)]
pub struct SetGlobalStateParams {
    /// The new authority for the global state.
    ///
    /// The authority can change certain global state parameters.
    new_authority: Pubkey,
    /// The new owner of the account that will hold protocol fees.
    new_fee_wallet: Pubkey,
    /// The new protocol fee (in basis points).
    new_protocol_fee_bps: u16,
}

#[derive(Accounts)]
#[instruction(params: SetGlobalStateParams)]
pub struct SetGlobalState<'info> {
    /// The global state account.
    #[account(mut, seeds = [b"global"], bump)]
    pub global_state: Account<'info, GlobalState>,

    /// The global state authority.
    #[account(address = global_state.authority @ ErrorCode::IncorrectGlobalStateAuthority)]
    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<SetGlobalState>, params: SetGlobalStateParams) -> Result<()> {
    let SetGlobalStateParams {
        new_authority,
        new_protocol_fee_bps,
        new_fee_wallet,
    } = params;

    let global_state = &mut ctx.accounts.global_state;

    global_state.protocol_fee_bps =
        Bps::new(new_protocol_fee_bps).ok_or_else(|| error!(ErrorCode::FeeTooHigh))?;

    global_state.authority = new_authority;
    global_state.fee_wallet = new_fee_wallet;

    Ok(())
}
