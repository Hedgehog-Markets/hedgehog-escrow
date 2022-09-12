use anchor_lang::prelude::*;

use crate::error::ErrorCode;

// FIXME: This should be 200;
const URI_MAX_LEN: usize = 256;

/// A string URI.
#[derive(Clone, AnchorDeserialize, AnchorSerialize)]
pub struct UriResource {
    /// The length of the URI.
    pub len: u16,
    /// The URI buffer.
    pub uri: [u8; URI_MAX_LEN],
}

impl Default for UriResource {
    fn default() -> Self {
        UriResource {
            len: 0,
            uri: [0u8; URI_MAX_LEN],
        }
    }
}

impl UriResource {
    /// Validates the resource.
    pub fn validate(uri: &str) -> Result<UriResource> {
        let len = uri.len();
        if len > URI_MAX_LEN {
            return Err(error!(ErrorCode::InvalidMarketResource));
        }

        let mut bytes = [0; URI_MAX_LEN];
        bytes[..len].copy_from_slice(uri.as_bytes());

        Ok(UriResource {
            len: len as u16,
            uri: bytes,
        })
    }

    pub const LEN: usize = 2 + URI_MAX_LEN;
}
