//! One publish at a time per site, across the app on any PC and the CLI
//! (GitHub Actions). Two publishes reading D1 at different times would
//! otherwise race, and the one that finishes last wins even if its data is
//! older.
//!
//! The lock is a row in `settings` ([`KEY`]), taken with a single
//! conditional upsert so that only one of two simultaneous publishes gets it.
//! A lock older than [`LEASE_MINUTES`] is taken over, so a publish that
//! crashed does not block the site for good.

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::d1::D1;
use crate::error::{Error, Result};

pub const KEY: &str = "zwa.publishing";
/// Longer than any publish should take.
pub const LEASE_MINUTES: u32 = 30;

/// Who publishes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Holder {
    App,
    GithubActions,
    Cli,
}

impl Holder {
    fn label(self) -> &'static str {
        match self {
            Holder::App => "ZWA CMS のアプリ",
            Holder::GithubActions => "GitHub Actions（予約投稿）",
            Holder::Cli => "コマンドラインツール zwa",
        }
    }
}

#[derive(Serialize, Deserialize)]
struct Value {
    by: Holder,
    token: String,
}

/// A publish holding the lock. Call [`PublishLock::release`] when done,
/// whether it worked or not.
pub struct PublishLock {
    token: String,
}

/// Someone else is publishing.
pub struct Busy {
    pub by: Option<Holder>,
    /// When they started (`updated_at` of the row, UTC).
    pub since: String,
}

impl Busy {
    pub fn message(&self) -> String {
        let who = self.by.map(Holder::label).unwrap_or("別の公開");
        format!(
            "{who}がサイトを公開している途中です（{} UTC に開始）。終わってから、もう一度公開してください。{LEASE_MINUTES} 分たっても終わらない場合は、止まったものとみなして公開できるようになります。",
            self.since.replace('T', " ").trim_end_matches('Z')
        )
    }
}

impl PublishLock {
    pub async fn acquire(d1: &D1<'_>, by: Holder) -> Result<std::result::Result<Self, Busy>> {
        let token = token();
        let value = serde_json::to_string(&Value {
            by,
            token: token.clone(),
        })?;
        #[derive(Deserialize)]
        struct Row {
            value: String,
            updated_at: String,
        }
        // The DO UPDATE only fires on a stale lock; otherwise nothing is
        // returned and the current holder is read below.
        let took = d1
            .rows::<Row>(
                &format!(
                    "INSERT INTO settings (key, value) VALUES (?1, ?2)
                     ON CONFLICT (key) DO UPDATE SET value = excluded.value,
                       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
                     WHERE settings.updated_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-{LEASE_MINUTES} minutes')
                     RETURNING value, updated_at"
                ),
                &[json!(KEY), json!(value)],
            )
            .await?;
        if took.iter().any(|r| r.value == value) {
            return Ok(Ok(Self { token }));
        }
        let current = d1
            .rows::<Row>(
                "SELECT value, updated_at FROM settings WHERE key = ?1",
                &[json!(KEY)],
            )
            .await?
            .pop();
        match current {
            Some(row) => Ok(Err(Busy {
                by: serde_json::from_str::<Value>(&row.value).ok().map(|v| v.by),
                since: row.updated_at,
            })),
            // Released between the two statements.
            None => Err(Error::Invalid(
                "別の公開が終わったところです。もう一度公開してください".into(),
            )),
        }
    }

    /// Removes the lock if it is still ours.
    pub async fn release(self, d1: &D1<'_>) -> Result<()> {
        d1.query(
            "DELETE FROM settings WHERE key = ?1 AND json_extract(value, '$.token') = ?2",
            &[json!(KEY), json!(self.token)],
        )
        .await?;
        Ok(())
    }
}

/// Unique enough to tell two publishes apart.
fn token() -> String {
    use sha2::{Digest, Sha256};
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let seed = format!("{nanos}:{}:{:p}", std::process::id(), &nanos);
    Sha256::digest(seed.as_bytes())[..12]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
