//! Reading a site's D1 database.

use std::collections::BTreeMap;

use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use zwa_site::{AuthorData, FormData, PostData, Redirect, SiteData, TermData};

use crate::cloudflare::{Client, QueryResult};
use crate::error::{Error, Result};

/// A site's D1 database.
/// Settings key: when the site was last published (see [`D1::mark_published`]).
pub const PUBLISHED_AT: &str = "zwa.published_at";

pub struct D1<'a> {
    pub client: &'a Client,
    pub account_id: &'a str,
    pub database_id: &'a str,
}

impl D1<'_> {
    /// Runs a single statement.
    pub async fn query(&self, sql: &str, params: &[Value]) -> Result<QueryResult> {
        self.client
            .d1_query(self.account_id, self.database_id, sql, params)
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| Error::Cloudflare("クエリの結果がありません".into()))
    }

    pub async fn rows<T: DeserializeOwned>(&self, sql: &str, params: &[Value]) -> Result<Vec<T>> {
        self.query(sql, params)
            .await?
            .results
            .into_iter()
            .map(|row| Ok(serde_json::from_value(row)?))
            .collect()
    }

    /// One value from the `settings` table.
    pub async fn setting(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .query("SELECT value FROM settings WHERE key = ?1", &[json!(key)])
            .await?
            .results
            .pop()
            .and_then(|r| r.get("value")?.as_str().map(String::from)))
    }

    /// D1's clock, in the format of `updated_at`.
    pub async fn now(&self) -> Result<String> {
        Ok(self
            .query("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now') AS now", &[])
            .await?
            .results
            .pop()
            .and_then(|r| r.get("now")?.as_str().map(String::from))
            .unwrap_or_default())
    }

    /// When the site was last published: the time its data was read for the
    /// build, so posts saved during the upload still count as not reflected.
    /// Stored in `settings` as [`PUBLISHED_AT`].
    pub async fn mark_published(&self, at: &str) -> Result<()> {
        self.query(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value,
               updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
            &[json!(PUBLISHED_AT), json!(at)],
        )
        .await?;
        Ok(())
    }

    /// Everything the generator needs.
    pub async fn load_site_data(&self) -> Result<SiteData> {
        #[derive(Deserialize)]
        struct Setting {
            key: String,
            value: String,
        }
        #[derive(Deserialize)]
        struct Link {
            post_id: i64,
            term_id: i64,
        }

        let settings: BTreeMap<String, String> = self
            .rows::<Setting>("SELECT key, value FROM settings", &[])
            .await?
            .into_iter()
            .map(|s| (s.key, s.value))
            .collect();
        let mut posts: Vec<PostData> = self
            .rows(
                "SELECT p.id, p.type, p.status, p.slug, p.title, p.body, p.body_format, p.excerpt,
                        p.parent_id, p.sort_order, p.published_at, p.updated_at, p.author_id, p.form_id,
                        '/' || m.r2_key AS image, m.alt_text AS image_alt
                 FROM posts p LEFT JOIN media m ON m.id = p.featured_media_id",
                &[],
            )
            .await?;
        let category_links: Vec<Link> = self
            .rows(
                "SELECT post_id, category_id AS term_id FROM post_categories",
                &[],
            )
            .await?;
        let tag_links: Vec<Link> = self
            .rows("SELECT post_id, tag_id AS term_id FROM post_tags", &[])
            .await?;
        for p in &mut posts {
            p.category_ids = category_links
                .iter()
                .filter(|l| l.post_id == p.id)
                .map(|l| l.term_id)
                .collect();
            p.tag_ids = tag_links
                .iter()
                .filter(|l| l.post_id == p.id)
                .map(|l| l.term_id)
                .collect();
        }
        let categories: Vec<TermData> = self
            .rows(
                "SELECT id, slug, name, description, parent_id, sort_order FROM categories
                 ORDER BY sort_order, name",
                &[],
            )
            .await?;
        let tags: Vec<TermData> = self
            .rows(
                "SELECT id, slug, name, description FROM tags ORDER BY name",
                &[],
            )
            .await?;
        let redirects: Vec<Redirect> = self
            .rows(
                "SELECT from_path, to_path, status_code FROM redirects ORDER BY id",
                &[],
            )
            .await?;
        let authors: Vec<AuthorData> = self
            .rows("SELECT id, slug, name, bio FROM authors ORDER BY name", &[])
            .await?;
        #[derive(Deserialize)]
        struct FormRow {
            id: i64,
            name: String,
            fields: String,
            submit_label: Option<String>,
            success_message: Option<String>,
        }
        let forms = self
            .rows::<FormRow>(
                "SELECT id, name, fields, submit_label, success_message FROM forms",
                &[],
            )
            .await?
            .into_iter()
            .map(|f| {
                Ok(FormData {
                    id: f.id,
                    name: f.name,
                    fields: serde_json::from_str(&f.fields)?,
                    submit_label: f.submit_label,
                    success_message: f.success_message,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(SiteData {
            settings,
            posts,
            categories,
            tags,
            redirects,
            authors,
            forms,
        })
    }
}
