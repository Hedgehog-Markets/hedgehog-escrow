use anchor_lang::prelude::*;

/// A possible market outcome.
#[repr(u8)]
#[derive(Clone, Copy, Eq, PartialEq, AnchorDeserialize, AnchorSerialize)]
pub enum Outcome {
    /// The market question has not yet resolved.
    Open,
    /// A positive outcome to the market question.
    Yes,
    /// A negative outcome to the market question.
    No,
    /// The market is no longer valid (e.g. the event was canceled).
    Invalid,
}

impl Default for Outcome {
    #[inline]
    fn default() -> Self {
        Outcome::Open
    }
}
