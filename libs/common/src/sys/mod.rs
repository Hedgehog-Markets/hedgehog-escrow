use anchor_lang::prelude::*;

#[cfg(not(target_arch = "bpf"))]
pub mod mock;

/// Returns the current unix timestamp.
pub fn timestamp() -> Result<u64> {
    Ok(Clock::get()?.unix_timestamp as u64)
}
