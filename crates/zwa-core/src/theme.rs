//! Custom theme files saved in R2 (`theme/<path>`), listed in the D1
//! `settings` table under `zwa.theme_files`.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::d1::D1;
use crate::error::{Error, Result};

pub const MANIFEST_KEY: &str = "zwa.theme_files";

const MAX_FILES: usize = 300;
const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
pub struct ThemeFile {
    pub path: String,
    pub size: u64,
    pub sha256: String,
}

pub fn r2_key(path: &str) -> String {
    format!("theme/{path}")
}

pub async fn manifest(db: &D1<'_>) -> Result<Vec<ThemeFile>> {
    match db.setting(MANIFEST_KEY).await? {
        Some(v) => Ok(serde_json::from_str(&v)?),
        None => Ok(vec![]),
    }
}

/// Downloads the saved theme (empty when the built-in theme is used).
pub async fn download(db: &D1<'_>, bucket: &str) -> Result<BTreeMap<String, Vec<u8>>> {
    let mut out = BTreeMap::new();
    for f in manifest(db).await? {
        let bytes = db
            .client
            .r2_get(db.account_id, bucket, &r2_key(&f.path))
            .await?;
        out.insert(f.path, bytes);
    }
    Ok(out)
}

/// The built-in theme as files, for a fresh copy to edit.
pub fn default_files() -> BTreeMap<String, Vec<u8>> {
    zwa_site::DEFAULT_THEME
        .iter()
        .map(|(name, source)| (name.to_string(), source.as_bytes().to_vec()))
        .collect()
}

/// Reads a theme folder. Hidden files and folders and README.md are
/// skipped; paths use `/`.
pub fn read_dir(root: &Path) -> Result<BTreeMap<String, Vec<u8>>> {
    fn walk(dir: &Path, root: &Path, out: &mut BTreeMap<String, Vec<u8>>) -> Result<()> {
        for entry in std::fs::read_dir(dir)? {
            let path = entry?.path();
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.starts_with('.') || name.eq_ignore_ascii_case("README.md") {
                continue;
            }
            if path.is_dir() {
                walk(&path, root, out)?;
                continue;
            }
            let rel = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            if std::fs::metadata(&path)?.len() > MAX_FILE_BYTES {
                return Err(Error::Invalid(format!(
                    "10MB を超えるファイルがあります: {rel}"
                )));
            }
            out.insert(rel, std::fs::read(&path)?);
            if out.len() > MAX_FILES {
                return Err(Error::Invalid(format!(
                    "ファイル数が多すぎます（上限 {MAX_FILES}）"
                )));
            }
        }
        Ok(())
    }
    if !root.is_dir() {
        return Err(Error::Invalid(format!(
            "フォルダが見つかりません: {}",
            root.display()
        )));
    }
    let mut out = BTreeMap::new();
    walk(root, root, &mut out)?;
    Ok(out)
}

/// Rejects an empty theme or templates that do not compile.
pub fn check(files: &BTreeMap<String, Vec<u8>>) -> Result<()> {
    if files.is_empty() {
        return Err(Error::Invalid("フォルダにファイルがありません".into()));
    }
    zwa_site::check_theme(files).map_err(|e| Error::Invalid(e.to_string()))
}

/// Replaces the saved theme with `files`: uploads what changed, deletes
/// what is gone, and rewrites the manifest.
pub async fn upload(db: &D1<'_>, bucket: &str, files: &BTreeMap<String, Vec<u8>>) -> Result<()> {
    check(files)?;
    let old = manifest(db).await?;
    let mut new_manifest = Vec::new();
    for (path, bytes) in files {
        let sha256: String = Sha256::digest(bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        let unchanged = old.iter().any(|f| &f.path == path && f.sha256 == sha256);
        if !unchanged {
            db.client
                .r2_put(
                    db.account_id,
                    bucket,
                    &r2_key(path),
                    crate::mime_from_key(path),
                    bytes.clone(),
                )
                .await?;
        }
        new_manifest.push(ThemeFile {
            path: path.clone(),
            size: bytes.len() as u64,
            sha256,
        });
    }
    save_manifest(db, &new_manifest).await?;
    for f in old.iter().filter(|f| !files.contains_key(&f.path)) {
        db.client
            .r2_delete(db.account_id, bucket, &r2_key(&f.path))
            .await?;
    }
    Ok(())
}

/// Goes back to the built-in theme (deletes the saved theme files).
pub async fn reset(db: &D1<'_>, bucket: &str) -> Result<()> {
    let old = manifest(db).await?;
    save_manifest(db, &[]).await?;
    for f in &old {
        db.client
            .r2_delete(db.account_id, bucket, &r2_key(&f.path))
            .await?;
    }
    Ok(())
}

async fn save_manifest(db: &D1<'_>, files: &[ThemeFile]) -> Result<()> {
    if files.is_empty() {
        db.query(
            "DELETE FROM settings WHERE key = ?1",
            &[json!(MANIFEST_KEY)],
        )
        .await?;
    } else {
        db.query(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value,
               updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
            &[json!(MANIFEST_KEY), json!(serde_json::to_string(files)?)],
        )
        .await?;
    }
    Ok(())
}
