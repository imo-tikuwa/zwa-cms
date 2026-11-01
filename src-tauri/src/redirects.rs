//! Redirects, written to the site's `_redirects` at build time.

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::AppHandle;

use crate::db::Db;
use crate::error::{Error, Result};

#[derive(Serialize, Deserialize)]
pub struct Redirect {
    id: i64,
    from_path: String,
    to_path: String,
    status_code: i64,
}

#[derive(Deserialize)]
pub struct RedirectInput {
    id: Option<i64>,
    from_path: String,
    to_path: String,
    status_code: i64,
}

fn validate(input: &RedirectInput) -> Result<()> {
    let from = input.from_path.trim();
    let to = input.to_path.trim();
    if !from.starts_with('/') {
        return Err(Error::Invalid(
            "転送元は / から始まるパスで入力してください".into(),
        ));
    }
    if !(to.starts_with('/') || to.starts_with("https://") || to.starts_with("http://")) {
        return Err(Error::Invalid(
            "転送先は / から始まるパスか、http(s):// から始まる URL で入力してください".into(),
        ));
    }
    // Each rule is one line of `from to status`.
    if from.contains(char::is_whitespace) || to.contains(char::is_whitespace) {
        return Err(Error::Invalid("パスに空白は使えません".into()));
    }
    // Workers static assets match the path only (query strings are not
    // supported in the source), so such a rule would never apply.
    if from.contains('?') {
        return Err(Error::Invalid(
            "転送元に ? 以降（クエリ文字列）は使えません。パスだけを指定してください".into(),
        ));
    }
    if from == to {
        return Err(Error::Invalid("転送元と転送先が同じです".into()));
    }
    if !matches!(input.status_code, 301 | 302) {
        return Err(Error::Invalid("不正なステータスコードです".into()));
    }
    Ok(())
}

#[tauri::command]
pub async fn redirects_list(app: AppHandle) -> Result<Vec<Redirect>> {
    Db::open(&app)?
        .rows(
            "SELECT id, from_path, to_path, status_code FROM redirects ORDER BY from_path",
            &[],
        )
        .await
}

#[tauri::command]
pub async fn redirect_save(app: AppHandle, input: RedirectInput) -> Result<()> {
    validate(&input)?;
    let db = Db::open(&app)?;
    let mut params = vec![
        json!(input.from_path.trim()),
        json!(input.to_path.trim()),
        json!(input.status_code),
    ];
    let sql = match input.id {
        None => "INSERT INTO redirects (from_path, to_path, status_code) VALUES (?1, ?2, ?3)",
        Some(id) => {
            params.push(json!(id));
            "UPDATE redirects SET from_path = ?1, to_path = ?2, status_code = ?3 WHERE id = ?4"
        }
    };
    db.query(sql, &params).await.map_err(|e| match e {
        Error::Cloudflare(msg) if msg.contains("UNIQUE") => {
            Error::Invalid("同じ転送元のリダイレクトがすでにあります".into())
        }
        e => e,
    })?;
    Ok(())
}

#[tauri::command]
pub async fn redirect_delete(app: AppHandle, id: i64) -> Result<()> {
    Db::open(&app)?
        .query("DELETE FROM redirects WHERE id = ?1", &[json!(id)])
        .await?;
    Ok(())
}
