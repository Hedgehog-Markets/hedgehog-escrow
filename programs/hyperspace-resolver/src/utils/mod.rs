use anchor_lang::prelude::*;

/// Returns the current unix timestamp.
pub fn unix_timestamp() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}
