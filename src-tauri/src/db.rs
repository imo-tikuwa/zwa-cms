//! Query helpers for the current site's D1 database.

use serde::de::DeserializeOwned;
use serde_json::Value;
use tauri::AppHandle;

use crate::cloudflare::{Client, QueryResult};
use crate::error::{Error, Result};
use crate::settings::Site;
use crate::sites::current_site;

/// SQL expression for the current time in the schema's timestamp format.
pub const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')";

pub struct Db {
    pub client: Client,
    pub site: Site,
}

impl Db {
    /// The shared D1 reader (`zwa-core`).
    pub fn d1(&self) -> zwa_core::d1::D1<'_> {
        zwa_core::d1::D1 {
            client: &self.client,
            account_id: &self.site.account_id,
            database_id: &self.site.d1_database_id,
        }
    }

    pub fn open(app: &AppHandle) -> Result<Self> {
        let (client, site) = current_site(app)?;
        Ok(Self { client, site })
    }

    /// Runs a single statement.
    pub async fn query(&self, sql: &str, params: &[Value]) -> Result<QueryResult> {
        self.client
            .d1_query(
                &self.site.account_id,
                &self.site.d1_database_id,
                sql,
                params,
            )
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| Error::Cloudflare("クエリの結果がありません".into()))
    }

    /// Runs several `;`-separated statements without parameters.
    pub async fn exec(&self, sql: &str) -> Result<()> {
        self.client
            .d1_query(&self.site.account_id, &self.site.d1_database_id, sql, &[])
            .await?;
        Ok(())
    }

    pub async fn rows<T: DeserializeOwned>(&self, sql: &str, params: &[Value]) -> Result<Vec<T>> {
        self.query(sql, params)
            .await?
            .results
            .into_iter()
            .map(|row| Ok(serde_json::from_value(row)?))
            .collect()
    }
}

/// Slugs end up in URL paths, so reject characters that would break them.
pub fn check_slug(slug: &str) -> Result<()> {
    let slug = slug.trim();
    if slug.is_empty() || slug.contains(['/', '?', '#', '%']) || slug.contains(char::is_whitespace)
    {
        return Err(Error::Invalid(
            "スラッグを入力してください（空白と / ? # % は使えません）".into(),
        ));
    }
    Ok(())
}

pub fn unique_slug_error(e: Error) -> Error {
    match e {
        Error::Cloudflare(msg) if msg.contains("UNIQUE") && msg.contains("slug") => {
            Error::Invalid("このスラッグは既に使われています".into())
        }
        e => e,
    }
}
