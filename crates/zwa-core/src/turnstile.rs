//! Cloudflare Turnstile widgets for contact forms
//! (https://developers.cloudflare.com/turnstile/get-started/widget-management/api/).
//!
//! The site key is stored in the site's settings. The secret is never
//! stored: each publish reads it from the widget and hands it to the Worker
//! as a secret binding, so any PC (or the CLI) can publish.

use serde::Deserialize;
use serde_json::json;

use crate::cloudflare::Client;
use crate::d1::D1;
use crate::error::{Error, Result};

/// `settings` key holding the widget's site key. Forms are enabled when set.
pub const SITEKEY: &str = zwa_site::keys::FORMS_SITEKEY;
/// Up to 10 hostnames per widget.
const MAX_DOMAINS: usize = 10;

#[derive(Clone, Debug, Deserialize)]
pub struct Widget {
    pub sitekey: String,
    pub secret: String,
    pub name: String,
    pub mode: String,
    #[serde(default)]
    pub domains: Vec<String>,
}

fn path(account: &str) -> String {
    format!("/accounts/{account}/challenges/widgets")
}

/// True for the errors Cloudflare returns when the token lacks the
/// Turnstile permission.
pub fn is_permission_error(e: &Error) -> bool {
    match e {
        Error::Cloudflare(m) => {
            m.contains("(10000)")
                || m.contains("(9109)")
                || m.contains("Authentication error")
                || m.contains("Unauthorized")
        }
        _ => false,
    }
}

pub async fn create(
    client: &Client,
    account: &str,
    name: &str,
    domains: &[String],
) -> Result<Widget> {
    client
        .post_json(
            &path(account),
            json!({ "name": name, "mode": "managed", "domains": domains }),
        )
        .await
}

pub async fn get(client: &Client, account: &str, sitekey: &str) -> Result<Widget> {
    client
        .get_json(&format!("{}/{sitekey}", path(account)))
        .await
}

pub async fn delete(client: &Client, account: &str, sitekey: &str) -> Result<()> {
    let _: serde_json::Value = client
        .delete_json(&format!("{}/{sitekey}", path(account)))
        .await?;
    Ok(())
}

/// Adds the hostnames the widget doesn't list yet (the site URL may have
/// changed since it was created).
pub async fn ensure_domains(
    client: &Client,
    account: &str,
    widget: &Widget,
    hosts: &[String],
) -> Result<Widget> {
    let mut domains = widget.domains.clone();
    for h in hosts {
        if !domains.iter().any(|d| d.eq_ignore_ascii_case(h)) {
            domains.push(h.clone());
        }
    }
    if domains.len() == widget.domains.len() {
        return Ok(widget.clone());
    }
    if domains.len() > MAX_DOMAINS {
        return Err(Error::Invalid(format!(
            "Turnstile に登録できるホスト名は {MAX_DOMAINS} 個までです。Cloudflare ダッシュボードの Turnstile で不要なホスト名を削除してください"
        )));
    }
    client
        .put_json(
            &format!("{}/{}", path(account), widget.sitekey),
            json!({ "name": widget.name, "mode": widget.mode, "domains": domains }),
        )
        .await
}

/// What the Worker needs to accept form submissions.
pub struct FormsBackend {
    pub database_id: String,
    pub turnstile_secret: String,
}

/// For a publish: `None` when the site has no forms enabled. `hosts` are
/// the hostnames the site is served from.
pub async fn backend(
    client: &Client,
    d1: &D1<'_>,
    hosts: &[String],
) -> Result<Option<FormsBackend>> {
    let Some(sitekey) = d1.setting(SITEKEY).await?.filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let widget = get(client, d1.account_id, &sitekey).await.map_err(|e| {
        if is_permission_error(&e) {
            Error::Invalid(
                "問い合わせフォームが有効なため、API トークンに Turnstile の権限（Account · Turnstile · Edit）が必要です".into(),
            )
        } else {
            e
        }
    })?;
    let widget = ensure_domains(client, d1.account_id, &widget, hosts).await?;
    Ok(Some(FormsBackend {
        database_id: d1.database_id.to_string(),
        turnstile_secret: widget.secret,
    }))
}

/// Hostnames the site is served from: workers.dev and `site.url` if set.
pub fn hosts(workers_dev: &str, site_url: Option<&str>) -> Vec<String> {
    let mut out: Vec<String> = host_of(workers_dev).into_iter().collect();
    if let Some(h) = site_url.and_then(host_of)
        && !out.contains(&h)
    {
        out.push(h);
    }
    out
}

/// Hostname of an absolute URL (`https://example.com/` -> `example.com`).
pub fn host_of(url: &str) -> Option<String> {
    let rest = url.split_once("://")?.1;
    let host = rest.split(['/', '?', '#']).next()?;
    let host = host.rsplit_once('@').map_or(host, |(_, h)| h);
    let host = host.split(':').next()?;
    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosts() {
        assert_eq!(
            host_of("https://Example.com/").as_deref(),
            Some("example.com")
        );
        assert_eq!(
            host_of("https://zwa-a.b.workers.dev").as_deref(),
            Some("zwa-a.b.workers.dev")
        );
        assert_eq!(
            host_of("http://localhost:8080/x").as_deref(),
            Some("localhost")
        );
        assert_eq!(host_of("example.com"), None);
    }
}
