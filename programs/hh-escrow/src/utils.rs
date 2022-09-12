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

pub fn signer_transfer<'info, 'a, 'b, 'c>(
    token_program: &Program<'info, Token>,
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    signer_seeds: &'a [&'b [&'c [u8]]],
    amount: u64,
) -> Result<()> {
    let ctx = CpiContext::new_with_signer(
        token_program.to_account_info(),
        Transfer {
            from: from.to_account_info(),
            to: to.to_account_info(),
            authority: authority.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer(ctx, amount)
}
