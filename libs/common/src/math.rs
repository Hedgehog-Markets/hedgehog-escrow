use std::hint;
use std::num::NonZeroU64;

/// Unchecked integer addition. Computes `x + y`, assuming overflow cannot
/// occur.
///
/// # Safety
///
/// This results in undefined behaviour when [`u64::checked_add`] would return
/// `None`.
#[must_use]
#[inline(always)]
pub unsafe fn unchecked_add(x: u64, y: u64) -> u64 {
    match x.checked_add(y) {
        Some(z) => z,
        None => hint::unreachable_unchecked(),
    }
}

/// Unchecked integer subtraction. Computes `x - y`, assuming overflow cannot
/// occur.
///
/// # Safety
///
/// This results in undefined behaviour when [`u64::checked_sub`] would return
/// `None`.
#[must_use]
#[inline(always)]
pub unsafe fn unchecked_sub(x: u64, y: u64) -> u64 {
    match x.checked_sub(y) {
        Some(z) => z,
        None => hint::unreachable_unchecked(),
    }
}

/// Unchecked integer multiplication. Computes `x * y`, assuming overflow cannot
/// occur.
///
/// # Safety
///
/// This results in undefined behaviour when [`u64::checked_mul`] would return
/// `None`.
#[must_use]
#[inline(always)]
pub unsafe fn unchecked_mul(x: u64, y: u64) -> u64 {
    match x.checked_mul(y) {
        Some(z) => z,
        None => hint::unreachable_unchecked(),
    }
}

/// Unchecked shift left. Computes `n << shift`, assuming that `shift` is less
/// than the number of bits in `n`.
///
/// # Safety
///
/// This results in undefined behaviour if `shift` is greater than or equal to
/// the number of bits in `n`, ie. when [`u64::checked_shl`] would return
/// `None`.
#[must_use]
#[inline(always)]
pub unsafe fn unchecked_shl(n: u64, shift: u32) -> u64 {
    match n.checked_shl(shift) {
        Some(m) => m,
        None => hint::unreachable_unchecked(),
    }
}

/// Unchecked shift right. Computes `n >> shift`, assuming that `shift` is less
/// than the number of bits in `n`.
///
/// # Safety
///
/// This results in undefined behaviour if `shift` is greater than or equal to
/// the number of bits in `n`, ie. when [`u64::checked_mshr`] would return
/// `None`.
#[must_use]
#[inline(always)]
pub unsafe fn unchecked_shr(n: u64, shift: u32) -> u64 {
    match n.checked_shr(shift) {
        Some(m) => m,
        None => hint::unreachable_unchecked(),
    }
}

/// Calculates the quotient of `x` and `y`, rounding the result towards positive infinity.
#[must_use]
#[inline(always)]
pub fn div_ceil(x: u64, y: NonZeroU64) -> u64 {
    let q = x / y;
    let r = x % y;
    // Consider this for the two cases:
    //
    // Case y == 1:
    //      q = x
    //      r = 0
    //   => q + (r != 0) = q
    //   => q + (r != 0) = x
    //
    // Case y > 1:
    //      q = x / y < x
    //   => q + 1 <= x
    //   => q + (r != 0) <= q + 1 <= x
    //
    // SAFETY: `q + (r != 0) <= x` and cannot overflow, thus the call to
    // `unchecked_add` is safe.
    unsafe { unchecked_add(q, (r != 0) as u64) }
}
