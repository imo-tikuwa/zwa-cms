//! Cloudflare access and publishing shared by the ZWA CMS desktop app and
//! the `zwa` CLI.

pub mod basic_auth;
pub mod cloudflare;
pub mod d1;
pub mod deploy;
pub mod error;
pub mod images;
pub mod publish_lock;
pub mod theme;
pub mod turnstile;

pub use error::{Error, Result};

pub fn mime_from_key(key: &str) -> &'static str {
    match key
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        Some("pdf") => "application/pdf",
        Some("mp4") => "video/mp4",
        Some("mp3") => "audio/mpeg",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("css") => "text/css; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Writes `bytes` to `dir/rel`, rejecting paths that would escape `dir`.
pub fn write_file(dir: &std::path::Path, rel: &str, bytes: &[u8]) -> Result<()> {
    let mut path = dir.to_path_buf();
    for seg in rel.split('/') {
        if seg.is_empty() || seg == "." || seg == ".." {
            return Err(Error::Invalid(format!("不正な出力パスです: {rel}")));
        }
        path.push(seg);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, bytes)?;
    Ok(())
}
