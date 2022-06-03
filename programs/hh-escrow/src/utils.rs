use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, Transfer};

pub fn non_signer_transfer<'info>(
    token_program: &Program<'info, Token>,
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    let ctx = CpiContext::new(
        token_program.to_account_info(),
        Transfer {
            from: from.to_account_info(),
            to: to.to_account_info(),
            authority: authority.to_account_info(),
        },
    );

    token::transfer(ctx, amount)
}
