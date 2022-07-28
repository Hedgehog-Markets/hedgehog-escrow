use anchor_lang::prelude::*;

use common::assume;
use common::bps::Bps as CommonBps;

/// Basis points.
///
/// The value can range from `0` (0%) to `10000` (100%).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    Default,
    AnchorDeserialize,
    AnchorSerialize,
)]
#[repr(transparent)]
pub struct Bps {
    bps: u16,
}

impl Bps {
    pub const LEN: usize = 2;

    /// The maximum value that a [`Bps`] can be.
    pub const MAX: u16 = CommonBps::MAX;

    /// Creates a [`Bps`] if the given value is within range.
    #[must_use]
    #[inline]
    pub const fn new(bps: u16) -> Option<Bps> {
        if bps <= CommonBps::MAX {
            Some(Bps { bps })
        } else {
            None
        }
    }

    /// Returns the value as a `u16`.
    #[must_use]
    #[inline]
    pub fn get(self) -> u16 {
        // SAFETY: The value is validated on creation, thus this is safe.
        unsafe { assume!(self.bps <= CommonBps::MAX) };

        self.bps
    }

    /// Returns the fee for the given amount, rounding up in the case of
    /// lost precision.
    #[must_use]
    #[inline]
    pub fn fee(self, amount: u64) -> u64 {
        self.to_common().fee(amount)
    }

    /// Returns the fee for the given amount, rounding up in the case of
    /// lost precision, and the amount received after subtracting the fee.
    #[must_use]
    #[inline]
    pub fn fee_received(self, amount: u64) -> (u64, u64) {
        self.to_common().fee_received(amount)
    }

    const fn to_common(self) -> CommonBps {
        // SAFETY: `self.inner <= CommonBps::MAX`.
        unsafe { CommonBps::new_unchecked(self.bps) }
    }
}
