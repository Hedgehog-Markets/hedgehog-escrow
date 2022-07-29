use anchor_lang::prelude::*;

/// A possible market outcome.
#[derive(Clone, Copy, Debug, Eq, PartialEq, AnchorDeserialize, AnchorSerialize)]
#[repr(u8)]
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

impl Outcome {
    pub const LEN: usize = 1;
}

impl Default for Outcome {
    #[inline]
    fn default() -> Self {
        Outcome::Open
    }
}
