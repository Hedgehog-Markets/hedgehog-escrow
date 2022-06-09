use std::num::NonZeroU64;

use anchor_lang::prelude::*;

use crate::math::{div_ceil, unchecked_add, unchecked_mul, unchecked_sub};

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
    /// The maximum value that a [`Bps`] can be.
    pub const MAX: u16 = 10_000;

    /// Creates a [`Bps`] without checking the value is within range.
    ///
    /// # Safety
    ///
    /// If `bps <= 10000` then computing the fee may result in undefined behaviour.
    #[must_use]
    #[inline]
    pub const unsafe fn new_unchecked(bps: u16) -> Bps {
        Bps { bps }
    }

    /// Creates a [`Bps`] if the given value is within range.
    #[must_use]
    #[inline]
    pub const fn new(bps: u16) -> Option<Bps> {
        if bps <= Bps::MAX {
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
        unsafe { assume!(self.bps <= Bps::MAX) };

        self.bps
    }

    /// Returns the fee for the given amount, rounding up in the case of
    /// lost precision.
    #[must_use]
    #[inline]
    pub fn fee(self, amount: u64) -> u64 {
        const DIVISOR: NonZeroU64 = unsafe { NonZeroU64::new_unchecked(Bps::MAX as u64) };

        // Compile time sanity check that `DIVISOR * DIVISOR` doesn't overflow `u64`.
        // Whilst this is trivially true, we use this fact in our logic to verify safety.
        static_assert!(DIVISOR.get().checked_mul(DIVISOR.get()).is_some());

        let bps = self.get() as u64; // Invariant: `bps <= DIVISOR`.

        let q = amount / DIVISOR;
        let r = amount % DIVISOR;

        // SAFETY: `bps <= DIVISOR`, so `(amount / DIVISOR) * bps <= amount` and
        // cannot overflow. Thus the call to `unchecked_mul` is safe.
        let a = unsafe { unchecked_mul(q, bps) };

        let c = {
            // SAFETY: `r = amount % DIVISOR`, so `r < DIVISOR`. Also `bps <= DIVISOR`
            // and `DIVISOR > 0`, so `r * bps < DIVISOR * DIVISOR` and cannot overflow.
            // Thus the call to `unchecked_mul` is safe.
            let b = unsafe { unchecked_mul(r, bps) };

            // Round up in the case of lost precision.
            div_ceil(b, DIVISOR)
        };

        // Consider:
        //      c = ceil((amount % DIVISOR) * bps / DIVISOR)
        //
        //      a = floor(amount / DIVISOR) * bps
        //   => a = (amount - (amount % DIVISOR)) * bps / DIVISOR
        //   => a = floor(amount * bps / DIVISOR) - floor((amount % DIVISOR) * bps / DIVISOR)
        //
        //      a + c = floor(amount * bps / DIVISOR) - floor((amount % DIVISOR) * bps / DIVISOR) + ceil((amount % DIVISOR) * bps / DIVISOR)
        //   => a + c = floor(amount * bps / DIVISOR) + (((amount * bps) % DIVISOR) != 0)
        //   => a + c = ceil(amount * bps / DIVISOR)
        //
        //   => a + c <= amount, since bps <= DIVISOR
        //
        // SAFETY: `a + c <= amount` and cannot overflow, thus the call to `unchecked_add` is safe.
        unsafe { unchecked_add(a, c) }
    }

    /// Returns the fee for the given amount, rounding up in the case of
    /// lost precision, and the amount received after subtracting the fee.
    #[must_use]
    #[inline]
    pub fn fee_received(self, amount: u64) -> (u64, u64) {
        let fee = self.fee(amount);

        // SAFETY: `fee <= amount`, so `amount - fee >= 0` and cannot overflow.
        // Thus the call to `unchecked_sub` is safe.
        let received = unsafe { unchecked_sub(amount, fee) };

        (fee, received)
    }
}

impl From<u8> for Bps {
    #[inline]
    fn from(bps: u8) -> Self {
        Bps { bps: bps as u16 }
    }
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU128;

    use quickcheck::TestResult;
    use quickcheck_macros::quickcheck;

    use super::*;

    #[inline(always)]
    fn fee_u128(amount: u64, bps: Bps) -> u64 {
        const DIVISOR: NonZeroU128 = unsafe { NonZeroU128::new_unchecked(Bps::MAX as u128) };

        let amount = amount as u128;
        let bps = bps.get() as u128;

        let dividend = amount * bps;

        let q = (dividend / DIVISOR) as u64;
        let r = (dividend % DIVISOR) as u64;

        q + ((r != 0) as u64)
    }

    #[quickcheck]
    fn fees_match_u128_impl(amount: u64, bps: u16) -> TestResult {
        let bps = match Bps::new(bps) {
            Some(bps) => bps,
            None => return TestResult::discard(),
        };
        TestResult::from_bool(bps.fee(amount) == fee_u128(amount, bps))
    }
}
