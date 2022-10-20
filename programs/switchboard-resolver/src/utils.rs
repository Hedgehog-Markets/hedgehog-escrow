use std::cell::Ref;

use anchor_lang::prelude::*;
use switchboard_v2::{AggregatorAccountData, SwitchboardError};

pub fn load_aggregator_account<'info>(
    feed: &'info AccountInfo<'_>,
) -> Result<Ref<'info, AggregatorAccountData>> {
    AggregatorAccountData::new(feed).map_err(|err| {
        let mismatch = u32::from(SwitchboardError::AccountDiscriminatorMismatch);
        let new_code = ErrorCode::AccountDiscriminatorMismatch;

        // Map the error returned by Switchboard to the appropriate Anchor one.
        match err {
            Error::AnchorError(mut anchor_err) => {
                if anchor_err.error_code_number == mismatch {
                    anchor_err.error_name = new_code.name();
                    anchor_err.error_code_number = new_code.into();
                    anchor_err.error_msg = new_code.to_string();
                }
                Error::AnchorError(anchor_err)
            }
            Error::ProgramError(mut program_error) => {
                if program_error.program_error == ProgramError::Custom(mismatch) {
                    program_error.program_error = ProgramError::Custom(new_code.into());
                }
                Error::ProgramError(program_error)
            }
        }
    })
}
