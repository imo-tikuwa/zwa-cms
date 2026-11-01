//! Custom themes. Theme files are stored in the site's R2 bucket under
//! `theme/`, with a manifest in the D1 `settings` table, so every machine
//! publishes the same theme. A local working folder can be set per machine
//! to preview changes before uploading them.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;

use crate::db::Db;
use crate::error::{Error, Result};
use crate::settings;
use zwa_core::theme::{ThemeFile, check, read_dir};

async fn manifest(db: &Db) -> Result<Vec<ThemeFile>> {
    Ok(zwa_core::theme::manifest(&db.d1()).await?)
}

#[derive(Serialize)]
pub struct ThemeStatus {
    /// Files of the saved custom theme; empty means the built-in theme.
    files: Vec<ThemeFile>,
    dev_dir: Option<String>,
}

/// Theme files for a build. The preview uses the local working folder when
/// one is set; publishing passes `use_dev_dir = false`.
pub async fn load_files(
    app: &AppHandle,
    db: &Db,
    use_dev_dir: bool,
) -> Result<BTreeMap<String, Vec<u8>>> {
    if use_dev_dir
        && let Some(dir) = settings::load(app)?
            .theme_dev_dirs
            .get(&db.site.d1_database_id)
    {
        return Ok(read_dir(Path::new(dir))?);
    }
    Ok(zwa_core::theme::download(&db.d1(), &db.site.r2_bucket).await?)
}

#[tauri::command]
pub async fn theme_status(app: AppHandle) -> Result<ThemeStatus> {
    let db = Db::open(&app)?;
    Ok(ThemeStatus {
        files: manifest(&db).await?,
        dev_dir: settings::load(&app)?
            .theme_dev_dirs
            .get(&db.site.d1_database_id)
            .cloned(),
    })
}

/// Writes the built-in theme and a short guide into `<dir>/<site id>-theme`
/// and returns that folder.
#[tauri::command]
pub fn theme_export_default(app: AppHandle, dir: String) -> Result<String> {
    let (_, site) = crate::sites::current_site(&app)?;
    let target = PathBuf::from(dir).join(format!("{}-theme", site.id));
    if target.exists() {
        return Err(Error::Invalid(format!(
            "{} は既に存在します。別のフォルダを選ぶか、削除してから書き出してください",
            target.display()
        )));
    }
    std::fs::create_dir_all(&target)?;
    for (name, source) in zwa_site::DEFAULT_THEME {
        std::fs::write(target.join(name), source)?;
    }
    std::fs::write(target.join("README.md"), zwa_site::THEME_GUIDE)?;
    Ok(target.to_string_lossy().into_owned())
}

/// Replaces the saved theme with the contents of a folder.
#[tauri::command]
pub async fn theme_upload(app: AppHandle, dir: String) -> Result<ThemeStatus> {
    let files = read_dir(Path::new(&dir))?;
    let db = Db::open(&app)?;
    zwa_core::theme::upload(&db.d1(), &db.site.r2_bucket, &files).await?;
    theme_status(app).await
}

/// Goes back to the built-in theme (deletes the saved theme files).
#[tauri::command]
pub async fn theme_reset(app: AppHandle) -> Result<ThemeStatus> {
    let db = Db::open(&app)?;
    zwa_core::theme::reset(&db.d1(), &db.site.r2_bucket).await?;
    theme_status(app).await
}

/// Sets (or clears, with None) the local working folder used by the preview.
#[tauri::command]
pub async fn theme_set_dev_dir(app: AppHandle, dir: Option<String>) -> Result<ThemeStatus> {
    let db = Db::open(&app)?;
    if let Some(d) = &dir {
        check(&read_dir(Path::new(d))?)?;
    }
    let mut s = settings::load(&app)?;
    match dir {
        Some(d) => s.theme_dev_dirs.insert(db.site.d1_database_id.clone(), d),
        None => s.theme_dev_dirs.remove(&db.site.d1_database_id),
    };
    settings::save(&app, &s)?;
    theme_status(app).await
}
