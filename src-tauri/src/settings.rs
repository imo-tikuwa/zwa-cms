//! Non-secret app settings, stored as JSON in the app config directory.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::Result;

#[derive(Default, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub account_id: Option<String>,
    #[serde(default)]
    pub sites: Vec<Site>,
    /// D1 database ID of the site being edited.
    pub current_site: Option<String>,
    /// Local theme working folder per site (D1 database ID -> path). Used
    /// by the preview only; publishing always uses the theme saved in R2.
    #[serde(default)]
    pub theme_dev_dirs: std::collections::BTreeMap<String, String>,
    /// Quit when the window is closed, instead of staying in the tray.
    #[serde(default)]
    pub quit_on_close: bool,
    /// No desktop notification when AI or publishing finishes while the
    /// window is hidden.
    #[serde(default, alias = "ai_notify_off")]
    pub notify_off: bool,
    /// No system sound when a confirmation or warning appears (Windows).
    #[serde(default)]
    pub sound_off: bool,
    /// Claude model for sites that don't choose one (`ai.model` unset).
    #[serde(default)]
    pub ai_default_model: Option<String>,
    /// Secrets are encrypted and opened with Windows Hello (src/lock).
    #[serde(default)]
    pub lock_enabled: bool,
    /// Minutes without use before locking (0 = only at startup). Unset = 30.
    #[serde(default)]
    pub lock_minutes: Option<u32>,
}

/// Local pointer to a site's Cloudflare resources. The site's own data
/// (including these names) lives in its D1 `settings` table, so another
/// machine can re-register it with "connect existing site".
#[derive(Clone, Serialize, Deserialize)]
pub struct Site {
    pub id: String,
    pub title: String,
    pub account_id: String,
    pub d1_database_id: String,
    pub d1_database_name: String,
    pub r2_bucket: String,
    pub worker_name: String,
}

fn path(app: &AppHandle) -> Result<PathBuf> {
    Ok(app.path().app_config_dir()?.join("settings.json"))
}

pub fn load(app: &AppHandle) -> Result<Settings> {
    match std::fs::read_to_string(path(app)?) {
        Ok(json) => Ok(serde_json::from_str(&json)?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(e) => Err(e.into()),
    }
}

pub fn save(app: &AppHandle, settings: &Settings) -> Result<()> {
    let path = path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, serde_json::to_string_pretty(settings)?)?;
    Ok(())
}
