//! Site-wide settings stored in the D1 `settings` table.

use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::json;
use tauri::AppHandle;

use crate::db::{Db, NOW};
use crate::error::{Error, Result};
use crate::settings;
use zwa_site::keys;

/// Keys editable from the settings screen. `zwa.*` keys are managed by the
/// app and not exposed here.
const EDITABLE: &[&str] = &[
    keys::TITLE,
    keys::DESCRIPTION,
    keys::URL,
    keys::LANGUAGE,
    keys::UTC_OFFSET,
    keys::POSTS_PER_PAGE,
    keys::IMAGE_MAX_WIDTH,
    keys::SEARCH,
    keys::PERMALINK_POST,
    keys::ACCENT_COLOR,
    keys::LOGO,
    keys::FAVICON,
    keys::FOOTER_TEXT,
    keys::CUSTOM_CSS,
    keys::COLOR_MODE,
    keys::BRIGHTNESS,
    keys::COLOR_SWITCH,
];

#[derive(Deserialize)]
struct Row {
    key: String,
    value: String,
}

#[tauri::command]
pub async fn site_settings_get(app: AppHandle) -> Result<BTreeMap<String, String>> {
    let rows: Vec<Row> = Db::open(&app)?
        .rows("SELECT key, value FROM settings", &[])
        .await?;
    Ok(rows
        .into_iter()
        .filter(|r| EDITABLE.contains(&r.key.as_str()))
        .map(|r| (r.key, r.value))
        .collect())
}

#[tauri::command]
pub async fn site_settings_save(app: AppHandle, values: BTreeMap<String, String>) -> Result<()> {
    let db = Db::open(&app)?;
    for (key, value) in &values {
        if !EDITABLE.contains(&key.as_str()) {
            return Err(Error::Invalid(format!("変更できない設定です: {key}")));
        }
        // Custom CSS keeps its formatting.
        let value = if key == keys::CUSTOM_CSS {
            value.as_str()
        } else {
            value.trim()
        };
        if key == keys::TITLE && value.is_empty() {
            return Err(Error::Invalid("サイト名を入力してください".into()));
        }
        if key == keys::URL
            && !value.is_empty()
            && !value.starts_with("https://")
            && !value.starts_with("http://")
        {
            return Err(Error::Invalid(
                "サイトの URL は https:// から入力してください".into(),
            ));
        }
        if key == keys::PERMALINK_POST
            && !value.is_empty()
            && !value.contains("{slug}")
            && !value.contains("{id}")
        {
            return Err(Error::Invalid(
                "パーマリンクには {slug} か {id} を含めてください".into(),
            ));
        }
        if key == keys::ACCENT_COLOR && !value.is_empty() {
            let hex = value.strip_prefix('#').unwrap_or("");
            if !(matches!(hex.len(), 3 | 6) && hex.chars().all(|c| c.is_ascii_hexdigit())) {
                return Err(Error::Invalid(format!(
                    "強調色は #rrggbb の形式で指定してください（入力: {value}）"
                )));
            }
        }
        // Empty means the default; anything else must be a value the theme knows.
        let allowed: &[&str] = match key.as_str() {
            keys::COLOR_MODE => &["light", "dark"],
            keys::BRIGHTNESS => &["-1", "0", "1"],
            keys::COLOR_SWITCH => &["on"],
            _ => &[],
        };
        if !allowed.is_empty() && !value.is_empty() && !allowed.contains(&value) {
            return Err(Error::Invalid(format!("{key} に使えない値です: {value}")));
        }
        if value.trim().is_empty() {
            db.query("DELETE FROM settings WHERE key = ?1", &[json!(key)])
                .await?;
        } else {
            db.query(
                &format!(
                    "INSERT INTO settings (key, value) VALUES (?1, ?2)
                     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = {NOW}"
                ),
                &[json!(key), json!(value)],
            )
            .await?;
        }
    }
    // Keep the site picker's cached title in sync.
    if let Some(title) = values.get(keys::TITLE) {
        let mut s = settings::load(&app)?;
        if let Some(site) = s
            .sites
            .iter_mut()
            .find(|x| x.d1_database_id == db.site.d1_database_id)
        {
            site.title = title.trim().to_string();
        }
        settings::save(&app, &s)?;
    }
    Ok(())
}

/// The Basic authentication user name, if the site is behind it. The
/// password is not stored (see `zwa_core::basic_auth`).
#[tauri::command]
pub async fn basic_auth_get(app: AppHandle) -> Result<Option<String>> {
    let db = Db::open(&app)?;
    Ok(zwa_core::basic_auth::load(&db.d1()).await?.map(|a| a.user))
}

/// Turns Basic authentication on, or changes its user name and password.
/// It takes effect on the next publish.
#[tauri::command]
pub async fn basic_auth_set(app: AppHandle, user: String, password: String) -> Result<()> {
    use aes_gcm::aead::{OsRng, rand_core::RngCore};
    use zwa_core::basic_auth::hash_password;

    let user = user.trim();
    if user.is_empty() || user.contains(':') || user.chars().any(char::is_control) {
        return Err(Error::Invalid(
            "ユーザー名を入力してください（「:」は使えません）".into(),
        ));
    }
    if password.chars().count() < 8 || password.chars().any(char::is_control) {
        return Err(Error::Invalid("パスワードは 8 文字以上にしてください".into()));
    }
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let hash = hash_password(&salt, &password);
    store_basic_auth(&app, user, &hash).await
}

/// Opens the site to everyone again (on the next publish).
#[tauri::command]
pub async fn basic_auth_clear(app: AppHandle) -> Result<()> {
    store_basic_auth(&app, "", "").await
}

/// Empty values rather than deleted rows, so that turning it off also counts
/// as a change the site does not show yet (`publish_status`).
async fn store_basic_auth(app: &AppHandle, user: &str, hash: &str) -> Result<()> {
    use zwa_core::basic_auth::{HASH, USER};
    let db = Db::open(app)?;
    for (key, value) in [(USER, user), (HASH, hash)] {
        db.query(
            &format!(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = {NOW}"
            ),
            &[json!(key), json!(value)],
        )
        .await?;
    }
    Ok(())
}
