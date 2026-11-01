//! Basic authentication for the whole published site, for sites that are
//! not open to everyone yet.
//!
//! The password is never stored: D1's settings hold the user name and a
//! salted SHA-256 of it, and the Worker compares against that hash. Keeping
//! it in D1 lets the CLI (GitHub Actions) publish with the same protection.
//!
//! While it is on, every request runs the Worker (`run_worker_first`), so
//! signed-in visitors' asset requests count toward the Workers request quota.

use crate::d1::D1;
use crate::error::Result;
use sha2::{Digest, Sha256};

pub const USER: &str = "auth.basic_user";
/// `<salt hex>:<SHA-256 hex of "<salt hex>:<password>">`
pub const HASH: &str = "auth.basic_hash";

/// What the Worker checks, passed as its `BASIC_AUTH` secret.
pub struct BasicAuth {
    pub user: String,
    pub hash: String,
}

impl BasicAuth {
    /// `<user>:<salt>:<hash>`. The user name cannot contain `:` (RFC 7617).
    pub fn binding(&self) -> String {
        format!("{}:{}", self.user, self.hash)
    }
}

/// The stored `auth.basic_hash` value for `password`.
pub fn hash_password(salt: &[u8], password: &str) -> String {
    let salt = hex(salt);
    let digest = Sha256::digest(format!("{salt}:{password}").as_bytes());
    format!("{salt}:{}", hex(&digest))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// For a publish: `None` when the site is open to everyone.
pub async fn load(d1: &D1<'_>) -> Result<Option<BasicAuth>> {
    let user = d1.setting(USER).await?.filter(|s| !s.is_empty());
    let hash = d1.setting(HASH).await?.filter(|s| !s.is_empty());
    Ok(user.zip(hash).map(|(user, hash)| BasicAuth { user, hash }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_matches_the_worker() {
        // worker.js computes SHA-256 over the same "<salt hex>:<password>".
        assert_eq!(
            hash_password(&[0xab, 0xcd], "パスワード"),
            format!(
                "abcd:{}",
                hex(&Sha256::digest("abcd:パスワード".as_bytes()))
            )
        );
    }
}
