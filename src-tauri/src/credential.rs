//! Cloudflare credentials stored in the OS keychain (encrypted while the app
//! lock is on, see `lock`).
//!
//! The credential is kept as a tagged JSON value so an OAuth variant
//! (access/refresh token) can be added later without changing callers.

use serde::{Deserialize, Serialize};

use crate::error::Result;

const SERVICE: &str = "zwa-cms";
const ENTRY: &str = "cloudflare";

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Credential {
    ApiToken { token: String },
}

impl Credential {
    pub fn bearer(&self) -> &str {
        match self {
            Credential::ApiToken { token } => token,
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            Credential::ApiToken { .. } => "api_token",
        }
    }
}

pub(crate) fn entry() -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(SERVICE, ENTRY)?)
}

pub fn load() -> Result<Option<Credential>> {
    match entry()?.get_password() {
        Ok(stored) => Ok(Some(serde_json::from_str(&crate::lock::open(stored)?)?)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn save(credential: &Credential) -> Result<()> {
    entry()?.set_password(&crate::lock::seal(&serde_json::to_string(credential)?))?;
    Ok(())
}

pub fn delete() -> Result<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}
