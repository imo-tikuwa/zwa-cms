//! Downscaling large images for the published site.

use std::io::Cursor;

use image::codecs::jpeg::JpegEncoder;
use image::{ImageFormat, imageops::FilterType};

/// Default maximum width in pixels (setting `site.image_max_width`).
pub const DEFAULT_MAX_WIDTH: u32 = 1600;
const JPEG_QUALITY: u8 = 82;

fn format_of(key: &str) -> Option<ImageFormat> {
    match key.rsplit_once('.')?.1.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => Some(ImageFormat::Jpeg),
        "png" => Some(ImageFormat::Png),
        // GIF (possibly animated), WebP, SVG etc. are copied unchanged.
        _ => None,
    }
}

/// Whether `bytes` would be resized (a JPEG/PNG wider than `max_width`).
pub fn needs_resize(key: &str, bytes: &[u8], max_width: u32) -> bool {
    format_of(key).is_some()
        && imagesize::blob_size(bytes).is_ok_and(|s| s.width as u32 > max_width)
}

/// Returns a downscaled copy, or None when not applicable or not smaller.
/// CPU-heavy: call from a blocking thread.
pub fn resize(key: &str, bytes: &[u8], max_width: u32) -> Option<Vec<u8>> {
    if !needs_resize(key, bytes, max_width) {
        return None;
    }
    let format = format_of(key)?;
    let img = image::load_from_memory_with_format(bytes, format).ok()?;
    let height = (img.height() as u64 * max_width as u64 / img.width() as u64).max(1) as u32;
    let img = img.resize_exact(max_width, height, FilterType::Lanczos3);
    let mut out = Vec::new();
    match format {
        ImageFormat::Jpeg => img
            .to_rgb8()
            .write_with_encoder(JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY))
            .ok()?,
        _ => img.write_to(&mut Cursor::new(&mut out), format).ok()?,
    }
    (out.len() < bytes.len()).then_some(out)
}

/// The configured maximum width, falling back to the default.
pub fn max_width(settings: &std::collections::BTreeMap<String, String>) -> u32 {
    settings
        .get(zwa_site::keys::IMAGE_MAX_WIDTH)
        .and_then(|v| v.parse::<u32>().ok())
        .filter(|w| *w >= 320)
        .unwrap_or(DEFAULT_MAX_WIDTH)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resizes_wide_jpeg() {
        let img = image::RgbImage::from_fn(3200, 1600, |x, y| {
            image::Rgb([(x % 256) as u8, (y % 256) as u8, 128])
        });
        let mut src = Vec::new();
        image::DynamicImage::ImageRgb8(img)
            .write_with_encoder(JpegEncoder::new_with_quality(&mut src, 95))
            .unwrap();
        let out = resize("a.jpg", &src, 1600).unwrap();
        let size = imagesize::blob_size(&out).unwrap();
        assert_eq!((size.width, size.height), (1600, 800));
    }

    #[test]
    fn skips_other_formats() {
        assert!(format_of("media/a.gif").is_none());
        assert!(format_of("media/a.webp").is_none());
        assert!(format_of("media/A.JPG").is_some());
    }
}
