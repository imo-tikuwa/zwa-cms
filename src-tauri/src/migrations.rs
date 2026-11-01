//! Applies `migrations/*.sql` to a site's D1 database.
//!
//! Applied migrations are recorded in `d1_migrations`, the same table
//! `wrangler d1 migrations apply` uses, so both tools can be mixed.

use std::collections::HashSet;
use std::sync::Mutex;

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::cloudflare::Client;
use crate::db::Db;
use crate::error::Result;

include!(concat!(env!("OUT_DIR"), "/migrations.rs"));

const CREATE_TABLE: &str = "CREATE TABLE IF NOT EXISTS d1_migrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)";

pub async fn apply(client: &Client, account_id: &str, database_id: &str) -> Result<()> {
    client
        .d1_query(account_id, database_id, CREATE_TABLE, &[])
        .await?;
    let applied: Vec<String> = client
        .d1_query(
            account_id,
            database_id,
            "SELECT name FROM d1_migrations",
            &[],
        )
        .await?
        .into_iter()
        .flat_map(|r| r.results)
        .filter_map(|row| row.get("name").and_then(Value::as_str).map(String::from))
        .collect();
    for (name, sql) in MIGRATIONS {
        if applied.iter().any(|a| a == name) {
            continue;
        }
        // File names are validated in build.rs, so inlining is safe.
        let sql = format!("{sql}\nINSERT INTO d1_migrations (name) VALUES ('{name}');");
        client.d1_query(account_id, database_id, &sql, &[]).await?;
    }
    Ok(())
}

/// Sites whose migrations were checked in this app session.
#[derive(Default)]
pub struct Checked(Mutex<HashSet<String>>);

/// Applies pending migrations to the current site once per session, so a
/// site set up by an older version of the app keeps working after an update.
pub async fn ensure(app: &AppHandle, db: &Db) -> Result<()> {
    let checked = app.state::<Checked>();
    if checked.0.lock().unwrap().contains(&db.site.d1_database_id) {
        return Ok(());
    }
    apply(&db.client, &db.site.account_id, &db.site.d1_database_id).await?;
    checked
        .0
        .lock()
        .unwrap()
        .insert(db.site.d1_database_id.clone());
    Ok(())
}

/// Called by the UI when a site becomes current.
#[tauri::command]
pub async fn site_migrate(app: AppHandle) -> Result<()> {
    ensure(&app, &Db::open(&app)?).await
}
