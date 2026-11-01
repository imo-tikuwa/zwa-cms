//! Publishes the built site to Cloudflare Workers Static Assets.
//!
//! Flow (https://developers.cloudflare.com/workers/static-assets/direct-upload/):
//! 1. POST .../assets-upload-session with a manifest of path -> {hash, size}
//! 2. Upload the files Cloudflare does not have yet, bucket by bucket
//! 3. PUT the Worker with the completion token
//!
//! The Worker (`worker.js`) is uploaded alongside, since the docs do not
//! cover assets-only uploads. Asset requests are served before it runs; it
//! forwards the rest to the ASSETS binding, and when forms are enabled it
//! also receives their submissions under `/_zwa/`. With Basic authentication
//! on, it runs before every request instead.

use std::collections::BTreeMap;
use std::path::Path;

use crate::basic_auth::BasicAuth;
use crate::cloudflare::Client;
use crate::error::{Error, Result};
use crate::turnstile::FormsBackend;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use reqwest::Method;
use reqwest::multipart::{Form, Part};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};

const MAX_FILES: usize = 20_000;
const MAX_FILE_BYTES: u64 = 25 * 1024 * 1024;
const COMPATIBILITY_DATE: &str = "2025-09-01";
const WORKER_JS: &str = include_str!("worker.js");

#[derive(Serialize)]
struct ManifestEntry {
    hash: String,
    size: u64,
}

#[derive(Deserialize)]
struct UploadSession {
    jwt: String,
    /// Missing or null when every file is already uploaded.
    #[serde(default, deserialize_with = "crate::cloudflare::null_as_empty")]
    buckets: Vec<Vec<String>>,
}


#[derive(Deserialize)]
struct UploadResult {
    jwt: Option<String>,
}

#[derive(Deserialize)]
struct AccountSubdomain {
    subdomain: String,
}

/// Result of a deploy.
#[derive(Clone, Debug, Serialize)]
pub struct DeploySummary {
    /// Files in the site.
    pub files: usize,
    /// Files actually sent (others were unchanged since the last deploy).
    pub uploaded: usize,
}

struct Asset {
    path: String,
    bytes: Vec<u8>,
}

fn collect(dir: &Path, base: &Path, out: &mut Vec<Asset>) -> Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            collect(&path, base, out)?;
        } else {
            let rel = path
                .strip_prefix(base)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            out.push(Asset {
                path: format!("/{rel}"),
                bytes: std::fs::read(&path)?,
            });
        }
    }
    Ok(())
}

/// Hash as in the official example: SHA-256 of base64(content) + extension,
/// first 32 hex characters.
fn asset_hash(asset: &Asset) -> String {
    let ext = asset.path.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
    let digest = Sha256::digest(format!("{}{ext}", STANDARD.encode(&asset.bytes)).as_bytes());
    digest
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>()[..32]
        .to_string()
}

fn content_type(path: &str) -> &'static str {
    match path
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("html") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("json") => "application/json",
        Some("xml") => "application/xml; charset=utf-8",
        Some("txt") => "text/plain; charset=utf-8",
        Some("wasm") => "application/wasm",
        _ => crate::mime_from_key(path),
    }
}

/// The Worker's workers.dev URL (without a trailing slash).
pub async fn workers_dev_url(client: &Client, account: &str, worker: &str) -> Result<String> {
    let subdomain: AccountSubdomain = client
        .get_json(&format!("/accounts/{account}/workers/subdomain"))
        .await
        .map_err(|e| {
            Error::Cloudflare(format!(
                "{e}\nworkers.dev のサブドメインが未設定の可能性があります。Cloudflare ダッシュボードの「Workers & Pages」を一度開いて設定してください。"
            ))
        })?;
    Ok(format!(
        "https://{worker}.{}.workers.dev",
        subdomain.subdomain
    ))
}

/// Uploads a built site directory as the Worker's static assets and
/// enables its workers.dev route. `forms` binds what the Worker needs to
/// accept form submissions ([`crate::turnstile::backend`]); `auth` puts the
/// whole site behind Basic authentication ([`crate::basic_auth::load`]).
pub async fn deploy_dir(
    client: &Client,
    account: &str,
    worker: &str,
    dir: &Path,
    forms: Option<&FormsBackend>,
    auth: Option<&BasicAuth>,
) -> Result<DeploySummary> {
    let mut assets = Vec::new();
    collect(dir, dir, &mut assets)?;
    // These two are passed as configuration, not served as files.
    let take = |assets: &mut Vec<Asset>, path: &str| {
        let i = assets.iter().position(|a| a.path == path)?;
        Some(String::from_utf8_lossy(&assets.remove(i).bytes).into_owned())
    };
    let headers = take(&mut assets, "/_headers");
    let redirects = take(&mut assets, "/_redirects");

    if assets.len() > MAX_FILES {
        return Err(Error::Invalid(format!(
            "ファイル数が上限（{MAX_FILES}）を超えています: {}",
            assets.len()
        )));
    }
    if let Some(big) = assets
        .iter()
        .find(|a| a.bytes.len() as u64 > MAX_FILE_BYTES)
    {
        return Err(Error::Invalid(format!(
            "25MB を超えるファイルがあります: {}",
            big.path
        )));
    }

    let hashes: Vec<String> = assets.iter().map(asset_hash).collect();
    let manifest: BTreeMap<&str, ManifestEntry> = assets
        .iter()
        .zip(&hashes)
        .map(|(a, h)| {
            (
                a.path.as_str(),
                ManifestEntry {
                    hash: h.clone(),
                    size: a.bytes.len() as u64,
                },
            )
        })
        .collect();
    log::info!(
        "deploy {worker}: {} files, {} bytes",
        assets.len(),
        assets.iter().map(|a| a.bytes.len()).sum::<usize>()
    );
    let session: UploadSession = client
        .post_json(
            &format!("/accounts/{account}/workers/scripts/{worker}/assets-upload-session"),
            json!({ "manifest": manifest }),
        )
        .await?;

    log::info!(
        "deploy {worker}: {} files to upload in {} batches (the rest are unchanged)",
        session.buckets.iter().map(Vec::len).sum::<usize>(),
        session.buckets.len()
    );
    let mut completion = session.jwt.clone();
    let mut uploaded = 0;
    for bucket in &session.buckets {
        let mut form = Form::new();
        for hash in bucket {
            let i = hashes
                .iter()
                .position(|h| h == hash)
                .ok_or_else(|| Error::Cloudflare(format!("不明なハッシュです: {hash}")))?;
            let part = Part::text(STANDARD.encode(&assets[i].bytes))
                .file_name(hash.clone())
                .mime_str(content_type(&assets[i].path))
                .map_err(|e| Error::Invalid(e.to_string()))?;
            form = form.part(hash.clone(), part);
            uploaded += 1;
        }
        let result: UploadResult = client
            .multipart(
                Method::POST,
                &format!("/accounts/{account}/workers/assets/upload?base64=true"),
                form,
                Some(&session.jwt),
            )
            .await?;
        if let Some(jwt) = result.jwt {
            completion = jwt;
        }
        log::info!("deploy {worker}: uploaded {uploaded} files");
    }

    let mut config = json!({
        "html_handling": "auto-trailing-slash",
        "not_found_handling": "404-page",
    });
    if let Some(h) = headers {
        config["_headers"] = json!(h);
    }
    if let Some(r) = redirects {
        config["_redirects"] = json!(r);
    }
    let mut bindings = vec![json!({ "name": "ASSETS", "type": "assets" })];
    if let Some(f) = forms {
        // Only form submissions need the Worker before the assets.
        config["run_worker_first"] = json!(["/_zwa/*"]);
        bindings.push(json!({ "name": "DB", "type": "d1", "database_id": f.database_id }));
        bindings.push(
            json!({ "name": "TURNSTILE_SECRET", "type": "secret_text", "text": f.turnstile_secret }),
        );
    }
    if let Some(a) = auth {
        // The Worker has to see every request to check the password.
        config["run_worker_first"] = json!(true);
        bindings.push(json!({ "name": "BASIC_AUTH", "type": "secret_text", "text": a.binding() }));
    }
    let metadata = json!({
        "main_module": "worker.js",
        "compatibility_date": COMPATIBILITY_DATE,
        "assets": { "jwt": completion, "config": config },
        "bindings": bindings,
    });
    let form = Form::new()
        .part(
            "metadata",
            Part::text(metadata.to_string())
                .mime_str("application/json")
                .unwrap(),
        )
        .part(
            "worker.js",
            Part::text(WORKER_JS)
                .file_name("worker.js")
                .mime_str("application/javascript+module")
                .unwrap(),
        );
    // The metadata carries the Turnstile secret; never log it.
    log::info!("deploy {worker}: uploading the Worker (forms: {})", forms.is_some());
    let _: serde_json::Value = client
        .multipart(
            Method::PUT,
            &format!("/accounts/{account}/workers/scripts/{worker}"),
            form,
            None,
        )
        .await?;

    let _: serde_json::Value = client
        .post_json(
            &format!("/accounts/{account}/workers/scripts/{worker}/subdomain"),
            json!({ "enabled": true, "previews_enabled": false }),
        )
        .await?;

    Ok(DeploySummary {
        files: assets.len(),
        uploaded,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upload_session_without_buckets() {
        for json in [r#"{"jwt":"x","buckets":null}"#, r#"{"jwt":"x"}"#, r#"{"jwt":"x","buckets":[["a"]]}"#] {
            let s: UploadSession = serde_json::from_str(json).unwrap();
            assert_eq!(s.jwt, "x");
            assert!(s.buckets.len() <= 1);
        }
    }

    #[test]
    fn hashes_are_32_hex_chars() {
        let h = asset_hash(&Asset {
            path: "/index.html".into(),
            bytes: b"hi".to_vec(),
        });
        assert_eq!(h.len(), 32);
        assert!(h.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
