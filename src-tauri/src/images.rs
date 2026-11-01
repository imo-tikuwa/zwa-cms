//! Downscaled copies of large images for the published site, cached on
//! disk (the resizing itself lives in `zwa-core`). Originals in R2 are
//! kept as uploaded.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::error::Result;
use crate::settings::Site;

fn cache_path(app: &AppHandle, site: &Site, max_width: u32, key: &str) -> Result<PathBuf> {
    let mut path = app
        .path()
        .app_cache_dir()?
        .join("resized")
        .join(&site.d1_database_id)
        .join(max_width.to_string());
    for seg in key.split('/') {
        path.push(seg);
    }
    Ok(path)
}

/// Returns `bytes` resized to `max_width` when it is a wider JPEG/PNG,
/// otherwise unchanged.
pub async fn for_site(
    app: &AppHandle,
    site: &Site,
    key: &str,
    bytes: Vec<u8>,
    max_width: u32,
) -> Vec<u8> {
    if !zwa_core::images::needs_resize(key, &bytes, max_width) {
        return bytes;
    }
    let Ok(cache) = cache_path(app, site, max_width, key) else {
        return bytes;
    };
    if let Ok(cached) = std::fs::read(&cache) {
        return cached;
    }
    let k = key.to_string();
    let resized = tokio::task::spawn_blocking(move || {
        zwa_core::images::resize(&k, &bytes, max_width).unwrap_or(bytes)
    })
    .await
    .unwrap_or_default();
    if let Some(dir) = cache.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&cache, &resized);
    resized
}
