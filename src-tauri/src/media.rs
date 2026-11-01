//! Media files: originals in R2, metadata in the D1 `media` table.
//!
//! Objects are stored under `media/YYYY/MM/<file>`; the same path is used as
//! the public URL (`/media/...`) when the site is built.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use tauri::http::{Response, StatusCode, header};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, UriSchemeContext, UriSchemeResponder};

use crate::db::{Db, NOW};
use crate::error::{Error, Result};
use crate::settings::Site;
use crate::sites::current_site;

/// Workers Static Assets rejects files larger than this, and media is
/// copied into the site's assets at build time.
const MAX_BYTES: usize = 25 * 1024 * 1024;

pub const SCHEME: &str = "zwa-media";

#[derive(Serialize, Deserialize)]
pub struct Media {
    id: i64,
    r2_key: String,
    filename: String,
    mime_type: String,
    size_bytes: i64,
    width: Option<i64>,
    height: Option<i64>,
    alt_text: Option<String>,
    caption: Option<String>,
    created_at: String,
}

const COLUMNS: &str =
    "id, r2_key, filename, mime_type, size_bytes, width, height, alt_text, caption, created_at";

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Keeps file names URL-friendly: ASCII letters, digits, `.`, `-`, `_`.
fn sanitize_filename(name: &str, fallback: &str) -> String {
    let name = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s, Some(e.to_ascii_lowercase())),
        _ => (name, None),
    };
    let mut stem: String = stem
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    while stem.contains("--") {
        stem = stem.replace("--", "-");
    }
    let stem = stem.trim_matches('-');
    let stem = if stem.is_empty() { fallback } else { stem };
    match ext.filter(|e| e.chars().all(|c| c.is_ascii_alphanumeric())) {
        Some(ext) => format!("{stem}.{ext}"),
        None => stem.to_string(),
    }
}

fn cache_path(app: &AppHandle, site: &Site, key: &str) -> Result<PathBuf> {
    let mut path = app
        .path()
        .app_cache_dir()?
        .join("media")
        .join(&site.d1_database_id);
    for seg in key.split('/') {
        // Keys come from our own sanitizer, but never let one escape the cache.
        if seg.is_empty() || seg == "." || seg == ".." {
            return Err(Error::Invalid("不正なメディアのパスです".into()));
        }
        path.push(seg);
    }
    Ok(path)
}

/// Returns the object, from the local cache when possible.
pub async fn read_object(app: &AppHandle, site: &Site, key: &str) -> Result<Vec<u8>> {
    let path = cache_path(app, site, key)?;
    if let Ok(bytes) = std::fs::read(&path) {
        return Ok(bytes);
    }
    let (client, _) = current_site(app)?;
    let bytes = client
        .r2_get(&site.account_id, &site.r2_bucket, key)
        .await?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(&path, &bytes)?;
    Ok(bytes)
}

#[tauri::command]
pub async fn media_list(app: AppHandle) -> Result<Vec<Media>> {
    Db::open(&app)?
        .rows(
            &format!("SELECT {COLUMNS} FROM media ORDER BY created_at DESC, id DESC"),
            &[],
        )
        .await
}

/// Body: raw file bytes. Headers: `x-filename` (URI-encoded), `x-mime-type`
/// (Tauri's IPC sets `content-type` to `application/octet-stream` itself).
#[tauri::command]
pub async fn media_upload(app: AppHandle, request: Request<'_>) -> Result<Media> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(Error::Invalid("ファイルの内容がありません".into()));
    };
    let bytes = bytes.clone();
    if bytes.len() > MAX_BYTES {
        return Err(Error::Invalid(
            "25MB を超えるファイルはアップロードできません".into(),
        ));
    }
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
    };
    let filename = percent_encoding::percent_decode_str(header("x-filename"))
        .decode_utf8_lossy()
        .into_owned();
    // The browser's guess, else the extension.
    let mime_type = match header("x-mime-type") {
        "" | "application/octet-stream" => zwa_core::mime_from_key(&filename),
        m => m,
    }
    .to_string();

    let db = Db::open(&app)?;
    let sha256 = hex(&Sha256::digest(&bytes));

    // The same file was uploaded before: reuse it.
    if let Some(existing) = db
        .rows::<Media>(
            &format!("SELECT {COLUMNS} FROM media WHERE sha256 = ?1 LIMIT 1"),
            &[json!(sha256)],
        )
        .await?
        .pop()
    {
        return Ok(existing);
    }

    let month: String = db
        .query("SELECT strftime('%Y/%m', 'now') AS m", &[])
        .await?
        .results
        .first()
        .and_then(|r| r.get("m")?.as_str().map(String::from))
        .ok_or_else(|| Error::Cloudflare("日付が取得できません".into()))?;
    let name = sanitize_filename(&filename, &sha256[..12]);
    let mut key = format!("media/{month}/{name}");
    let taken = db
        .query("SELECT 1 FROM media WHERE r2_key = ?1", &[json!(key)])
        .await?
        .results
        .len();
    if taken > 0 {
        key = format!("media/{month}/{}-{name}", &sha256[..8]);
    }

    let size = imagesize::blob_size(&bytes).ok();
    db.client
        .r2_put(
            &db.site.account_id,
            &db.site.r2_bucket,
            &key,
            &mime_type,
            bytes.clone(),
        )
        .await?;
    // Seed the cache so the editor can show the image without a download.
    if let Ok(path) = cache_path(&app, &db.site, &key) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(path, &bytes);
    }

    db.rows::<Media>(
        &format!(
            "INSERT INTO media (r2_key, filename, mime_type, size_bytes, width, height, sha256)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING {COLUMNS}"
        ),
        &[
            json!(key),
            json!(filename),
            json!(mime_type),
            json!(bytes.len()),
            json!(size.map(|s| s.width)),
            json!(size.map(|s| s.height)),
            json!(sha256),
        ],
    )
    .await?
    .pop()
    .ok_or_else(|| Error::Cloudflare("登録したメディアが取得できません".into()))
}

#[tauri::command]
pub async fn media_update(
    app: AppHandle,
    id: i64,
    alt_text: Option<String>,
    caption: Option<String>,
) -> Result<()> {
    let blank_to_null = |v: Option<String>| v.filter(|s| !s.trim().is_empty());
    Db::open(&app)?
        .query(
            &format!(
                "UPDATE media SET alt_text = ?1, caption = ?2, updated_at = {NOW} WHERE id = ?3"
            ),
            &[
                json!(blank_to_null(alt_text)),
                json!(blank_to_null(caption)),
                json!(id),
            ],
        )
        .await?;
    Ok(())
}

/// Deletes the R2 object and the row. Posts that still reference the file
/// will show a broken image; the UI warns about this.
#[tauri::command]
pub async fn media_delete(app: AppHandle, id: i64) -> Result<()> {
    let db = Db::open(&app)?;
    let Some(media) = db
        .rows::<Media>(
            &format!("SELECT {COLUMNS} FROM media WHERE id = ?1"),
            &[json!(id)],
        )
        .await?
        .pop()
    else {
        return Ok(());
    };
    db.client
        .r2_delete(&db.site.account_id, &db.site.r2_bucket, &media.r2_key)
        .await?;
    db.query("DELETE FROM media WHERE id = ?1", &[json!(id)])
        .await?;
    if let Ok(path) = cache_path(&app, &db.site, &media.r2_key) {
        let _ = std::fs::remove_file(path);
    }
    Ok(())
}

/// `zwa-media://localhost/<r2 key>` serves the current site's media to the
/// webview (thumbnails, images in the editor).
pub fn protocol(
    ctx: UriSchemeContext<'_, tauri::Wry>,
    request: tauri::http::Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    let path = request.uri().path().trim_start_matches('/').to_string();
    tauri::async_runtime::spawn(async move {
        let key = percent_encoding::percent_decode_str(&path)
            .decode_utf8_lossy()
            .into_owned();
        let result = async {
            let (_, site) = current_site(&app)?;
            read_object(&app, &site, &key).await
        }
        .await;
        let response = match result {
            Ok(bytes) => Response::builder()
                .header(header::CONTENT_TYPE, mime_from_key(&key))
                .header(header::CACHE_CONTROL, "max-age=3600")
                .body(bytes),
            Err(e) => Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(e.to_string().into_bytes()),
        };
        responder.respond(response.unwrap());
    });
}

pub use zwa_core::mime_from_key;

#[cfg(test)]
mod tests {
    use super::sanitize_filename;

    #[test]
    fn sanitizes_names() {
        assert_eq!(sanitize_filename("My Photo.JPG", "x"), "my-photo.jpg");
        assert_eq!(sanitize_filename("写真.png", "abc"), "abc.png");
        assert_eq!(sanitize_filename("C:\\a\\b c--d.jpeg", "x"), "b-c-d.jpeg");
        assert_eq!(sanitize_filename(".hidden", "x"), "hidden");
    }
}
