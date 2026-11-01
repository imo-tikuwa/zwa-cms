//! Site setup: creates (or reconnects) the D1 database and R2 bucket for a
//! site. The Worker is created on first publish, since it cannot exist
//! without uploaded assets.

use serde::Serialize;
use serde_json::{Value, json};
use tauri::AppHandle;

use crate::auth::current_credential;
use crate::cloudflare::{Client, D1Database};
use crate::error::{Error, Result};
use crate::migrations;
use crate::settings::{self, Site};

const KEY_TITLE: &str = "site.title";
const KEY_SITE_ID: &str = "zwa.site_id";
const KEY_R2_BUCKET: &str = "zwa.r2_bucket";
const KEY_WORKER_NAME: &str = "zwa.worker_name";

/// Resource names derived from a site ID. The site ID must satisfy the
/// strictest of the three naming rules (R2 bucket / Worker name):
/// lowercase letters, digits and hyphens.
pub struct ResourceNames {
    pub d1: String,
    pub r2: String,
    pub worker: String,
}

impl ResourceNames {
    pub fn for_site(site_id: &str) -> Self {
        Self {
            d1: format!("zwa-{site_id}"),
            r2: format!("zwa-{site_id}-media"),
            worker: format!("zwa-{site_id}"),
        }
    }
}

fn validate_site_id(id: &str) -> Result<()> {
    let ok = (2..=32).contains(&id.len())
        && id.starts_with(|c: char| c.is_ascii_lowercase())
        && !id.ends_with('-')
        && !id.contains("--")
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if ok {
        Ok(())
    } else {
        Err(Error::Invalid(
            "サイト ID は英小文字で始まる 2〜32 文字の英小文字・数字・ハイフンにしてください"
                .into(),
        ))
    }
}

/// The site currently being edited, with a client for its account.
pub fn current_site(app: &AppHandle) -> Result<(Client, Site)> {
    let settings = settings::load(app)?;
    let site = settings
        .current_site
        .and_then(|id| settings.sites.into_iter().find(|s| s.d1_database_id == id))
        .ok_or_else(|| Error::Invalid("サイトを選択してください".into()))?;
    Ok((Client::new(current_credential()?.bearer()), site))
}

fn require_account(app: &AppHandle) -> Result<String> {
    settings::load(app)?
        .account_id
        .ok_or_else(|| Error::Invalid("Cloudflare アカウントを選択してください".into()))
}

#[derive(Serialize)]
pub struct SitesState {
    sites: Vec<Site>,
    current_site: Option<String>,
}

fn state(app: &AppHandle) -> Result<SitesState> {
    let settings = settings::load(app)?;
    let account_id = settings.account_id.clone();
    let sites: Vec<Site> = settings
        .sites
        .into_iter()
        .filter(|s| Some(&s.account_id) == account_id.as_ref())
        .collect();
    let current_site = settings
        .current_site
        .filter(|id| sites.iter().any(|s| &s.d1_database_id == id));
    Ok(SitesState {
        sites,
        current_site,
    })
}

fn register(app: &AppHandle, site: Site) -> Result<SitesState> {
    let mut settings = settings::load(app)?;
    settings
        .sites
        .retain(|s| s.d1_database_id != site.d1_database_id);
    settings.current_site = Some(site.d1_database_id.clone());
    settings.sites.push(site);
    settings::save(app, &settings)?;
    state(app)
}

#[tauri::command]
pub fn sites_state(app: AppHandle) -> Result<SitesState> {
    state(&app)
}

#[tauri::command]
pub fn site_select(app: AppHandle, database_id: String) -> Result<SitesState> {
    let mut settings = settings::load(&app)?;
    settings.current_site = Some(database_id);
    settings::save(&app, &settings)?;
    state(&app)
}

/// Removes the site from this machine's list. Cloudflare resources are kept.
#[tauri::command]
pub fn site_forget(app: AppHandle, database_id: String) -> Result<SitesState> {
    let mut settings = settings::load(&app)?;
    settings.sites.retain(|s| s.d1_database_id != database_id);
    if settings.current_site.as_deref() == Some(&database_id) {
        settings.current_site = None;
    }
    settings::save(&app, &settings)?;
    state(&app)
}

/// Creates the site's resources. Safe to re-run after a partial failure:
/// existing resources with the same names are reused.
#[tauri::command]
pub async fn site_create(app: AppHandle, site_id: String, title: String) -> Result<SitesState> {
    validate_site_id(&site_id)?;
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err(Error::Invalid("サイト名を入力してください".into()));
    }
    let account_id = require_account(&app)?;
    let client = Client::new(current_credential()?.bearer());
    let names = ResourceNames::for_site(&site_id);
    log::info!("site create {site_id}: start");

    let existing = client.d1_list(&account_id).await?;
    let db = match existing.into_iter().find(|d| d.name == names.d1) {
        Some(db) => db,
        None => client.d1_create(&account_id, &names.d1).await?,
    };
    log::info!("site create {site_id}: D1 {} ready", names.d1);

    let buckets = client.r2_list(&account_id).await.map_err(r2_hint)?;
    if !buckets.iter().any(|b| b.name == names.r2) {
        client
            .r2_create(&account_id, &names.r2)
            .await
            .map_err(r2_hint)?;
    }
    log::info!("site create {site_id}: R2 {} ready", names.r2);

    migrations::apply(&client, &account_id, &db.uuid).await?;
    log::info!("site create {site_id}: migrations applied");

    for (key, value) in [
        (KEY_TITLE, title.as_str()),
        (KEY_SITE_ID, site_id.as_str()),
        (KEY_R2_BUCKET, names.r2.as_str()),
        (KEY_WORKER_NAME, names.worker.as_str()),
    ] {
        client
            .d1_query(
                &account_id,
                &db.uuid,
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT (key) DO UPDATE SET value = excluded.value,
                   updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
                &[json!(key), json!(value)],
            )
            .await?;
    }

    register(
        &app,
        Site {
            id: site_id,
            title,
            account_id,
            d1_database_id: db.uuid,
            d1_database_name: db.name,
            r2_bucket: names.r2,
            worker_name: names.worker,
        },
    )
}

/// R2 must be enabled once per account in the dashboard before the API works.
fn r2_hint(e: zwa_core::Error) -> Error {
    match Error::from(e) {
        Error::Cloudflare(msg) if msg.contains("10042") => Error::Cloudflare(format!(
            "{msg}\nR2 が有効になっていません。Cloudflare ダッシュボードの「R2」から一度有効化してください。"
        )),
        e => e,
    }
}

/// D1 databases in the account that are not registered on this machine.
#[tauri::command]
pub async fn site_connect_candidates(app: AppHandle) -> Result<Vec<D1Database>> {
    let account_id = require_account(&app)?;
    let registered = settings::load(&app)?.sites;
    let client = Client::new(current_credential()?.bearer());
    Ok(client
        .d1_list(&account_id)
        .await?
        .into_iter()
        .filter(|d| !registered.iter().any(|s| s.d1_database_id == d.uuid))
        .collect())
}

/// Registers a site that was set up elsewhere, reading its resource names
/// from its D1 `settings` table.
#[tauri::command]
pub async fn site_connect(app: AppHandle, database_id: String) -> Result<SitesState> {
    let account_id = require_account(&app)?;
    let client = Client::new(current_credential()?.bearer());
    let db = client
        .d1_list(&account_id)
        .await?
        .into_iter()
        .find(|d| d.uuid == database_id)
        .ok_or_else(|| Error::Invalid("データベースが見つかりません".into()))?;

    let not_a_site = || Error::Invalid(format!("{} は ZWA CMS のサイトではありません", db.name));
    let rows = client
        .d1_query(
            &account_id,
            &db.uuid,
            "SELECT key, value FROM settings WHERE key IN (?1, ?2, ?3, ?4)",
            &[
                json!(KEY_TITLE),
                json!(KEY_SITE_ID),
                json!(KEY_R2_BUCKET),
                json!(KEY_WORKER_NAME),
            ],
        )
        .await
        .map_err(|_| not_a_site())?;
    let get = |key: &str| -> Option<String> {
        rows.iter()
            .flat_map(|r| &r.results)
            .find(|row| row.get("key").and_then(Value::as_str) == Some(key))
            .and_then(|row| row.get("value")?.as_str().map(String::from))
    };

    // Run pending migrations so an older site works with this app version.
    migrations::apply(&client, &account_id, &db.uuid).await?;

    register(
        &app,
        Site {
            id: get(KEY_SITE_ID).ok_or_else(not_a_site)?,
            title: get(KEY_TITLE).unwrap_or_else(|| db.name.clone()),
            account_id,
            r2_bucket: get(KEY_R2_BUCKET).ok_or_else(not_a_site)?,
            worker_name: get(KEY_WORKER_NAME).ok_or_else(not_a_site)?,
            d1_database_id: db.uuid,
            d1_database_name: db.name,
        },
    )
}

#[derive(Serialize)]
pub struct DeleteResult {
    state: SitesState,
    /// Things left behind that the user may want to remove by hand.
    warnings: Vec<String>,
}

/// Deletes the current site and everything the app made for it on
/// Cloudflare: the scheduler Worker and Actions token (GitHub link), the
/// Turnstile widget, the Worker, the R2 bucket and the D1 database. The
/// GitHub repository and tokens are left alone.
///
/// The D1 database goes last, since it lists the rest: after a failure the
/// site stays in the list and deleting it again picks up where it stopped.
#[tauri::command]
pub async fn site_delete(app: AppHandle, site_id: String) -> Result<DeleteResult> {
    use futures_util::{StreamExt, TryStreamExt, stream};

    let db = crate::db::Db::open(&app)?;
    let site = db.site.clone();
    if site_id != site.id {
        return Err(Error::Invalid("サイト ID が一致しません".into()));
    }
    let account = &site.account_id;
    let mut warnings = Vec::new();
    log::info!("site delete {}: start", site.id);

    crate::github::github_unlink(app.clone()).await?;
    if let Some(w) = crate::forms::forms_disable(app.clone()).await? {
        log::warn!("site delete {}: {w}", site.id);
        warnings.push(w);
    }

    // Not there yet if the site was never published.
    match cf_delete(
        &db.client,
        &format!("/accounts/{account}/workers/scripts/{}", site.worker_name),
    )
    .await
    {
        Err(Error::Cloudflare(m)) if m.contains("10007") => {}
        r => r?,
    }
    log::info!("site delete {}: Worker removed", site.id);

    let bucket_exists = db
        .client
        .r2_list(account)
        .await?
        .iter()
        .any(|b| b.name == site.r2_bucket);
    if bucket_exists {
        // A bucket must be empty to be deleted. The app only writes media
        // (listed in `media`) and theme files (listed in the manifest).
        #[derive(serde::Deserialize)]
        struct Key {
            r2_key: String,
        }
        let mut keys: Vec<String> = db
            .rows::<Key>("SELECT r2_key FROM media", &[])
            .await?
            .into_iter()
            .map(|k| k.r2_key)
            .collect();
        keys.extend(
            zwa_core::theme::manifest(&db.d1())
                .await?
                .iter()
                .map(|f| zwa_core::theme::r2_key(&f.path)),
        );
        log::info!(
            "site delete {}: removing {} R2 objects",
            site.id,
            keys.len()
        );
        stream::iter(keys)
            .map(|key| {
                let (client, bucket) = (&db.client, &site.r2_bucket);
                async move { client.r2_delete(account, bucket, &key).await }
            })
            .buffer_unordered(8)
            .try_collect::<Vec<()>>()
            .await?;
        cf_delete(&db.client, &format!("/accounts/{account}/r2/buckets/{}", site.r2_bucket))
            .await
            .map_err(|e| {
                Error::Invalid(format!(
                    "R2 バケット {} を削除できませんでした。アプリが把握していないファイルが残っている場合は、Cloudflare ダッシュボードの R2 で空にしてから、もう一度削除してください。\n{e}",
                    site.r2_bucket
                ))
            })?;
    }
    log::info!("site delete {}: R2 bucket removed", site.id);

    cf_delete(
        &db.client,
        &format!("/accounts/{account}/d1/database/{}", site.d1_database_id),
    )
    .await?;
    log::info!("site delete {}: D1 database removed", site.id);

    let state = site_forget(app, site.d1_database_id)?;
    Ok(DeleteResult { state, warnings })
}

/// DELETE that may answer with a null `result`.
async fn cf_delete(client: &Client, path: &str) -> Result<()> {
    match client.delete_json::<Value>(path).await {
        Ok(_) => Ok(()),
        Err(zwa_core::Error::Cloudflare(m)) if m == "result がありません" => Ok(()),
        Err(e) => Err(e.into()),
    }
}
