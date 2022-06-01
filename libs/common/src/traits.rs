use anchor_lang::prelude::*;

pub trait KeyRef {
    /// Get a reference to the pubkey of an account.
    ///
    /// For functions that take a reference to a [`Pubkey`] this is more
    /// efficient than [`Key`] which creates a copy of the pubkey.
    fn key_ref(&self) -> &Pubkey;
}

impl<T> KeyRef for Account<'_, T>
where
    T: AccountSerialize + AccountDeserialize + Owner + Clone,
{
    #[inline]
    fn key_ref(&self) -> &Pubkey {
        AsRef::<AccountInfo>::as_ref(&self).key
    }
}

impl<T> KeyRef for AccountLoader<'_, T>
where
    T: anchor_lang::ZeroCopy + Owner,
{
    #[inline]
    fn key_ref(&self) -> &Pubkey {
        AsRef::<AccountInfo>::as_ref(&self).key
    }
}

impl<T> KeyRef for Sysvar<'_, T>
where
    T: solana_program::sysvar::Sysvar,
{
    #[inline]
    fn key_ref(&self) -> &Pubkey {
        AsRef::<AccountInfo>::as_ref(&self).key
    }
}

impl KeyRef for AccountInfo<'_> {
    #[inline]
    fn key_ref(&self) -> &Pubkey {
        self.key
    }
}

impl KeyRef for AccountMeta {
    #[inline]
    fn key_ref(&self) -> &Pubkey {
        &self.pubkey
    }
}

impl KeyRef for Pubkey {
    #[inline]
    fn key_ref(&self) -> &Pubkey {
        self
    }
}
