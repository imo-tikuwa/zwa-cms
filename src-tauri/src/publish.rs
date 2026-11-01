//! Publishes the built site to Cloudflare Workers Static Assets (the upload
//! itself lives in `zwa-core`, shared with the CLI).

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use zwa_site::BuildOptions;

use crate::db::{Db, NOW};
use crate::error::Result;
use crate::sitebuild::build_to_dir;

#[derive(Serialize)]
pub struct PublishResult {
    url: String,
    files: usize,
    uploaded: usize,
    warnings: Vec<String>,
}

#[tauri::command]
pub async fn site_publish(app: AppHandle) -> Result<PublishResult> {
    let started = std::time::Instant::now();
    log::info!("publish: started");
    let result = publish(&app).await;
    match &result {
        Ok(r) => log::info!(
            "publish: done in {:.1}s, {} files ({} uploaded), {} warnings: {}",
            started.elapsed().as_secs_f32(),
            r.files,
            r.uploaded,
            r.warnings.len(),
            r.url
        ),
        Err(e) => log::error!("publish: failed after {:.1}s: {e}", started.elapsed().as_secs_f32()),
    }
    // The user may have closed the window to the tray while waiting.
    let body = match &result {
        Ok(r) if r.warnings.is_empty() => format!("公開しました: {}", r.url),
        Ok(r) => format!("公開しました（警告 {} 件）: {}", r.warnings.len(), r.url),
        Err(e) => format!("公開に失敗しました: {e}"),
    };
    crate::tray::notify_if_hidden(&app, "ZWA CMS の公開", &body);
    result
}

async fn publish(app: &AppHandle) -> Result<PublishResult> {
    use zwa_core::publish_lock::{Holder, PublishLock};
    let db = Db::open(app)?;
    let lock = PublishLock::acquire(&db.d1(), Holder::App)
        .await?
        .map_err(|busy| crate::error::Error::Invalid(busy.message()))?;
    let result = publish_locked(app, &db).await;
    if let Err(e) = lock.release(&db.d1()).await {
        log::warn!("publish: could not release the lock (it expires on its own): {e}");
    }
    result
}

async fn publish_locked(app: &AppHandle, db: &Db) -> Result<PublishResult> {
    let account = db.site.account_id.clone();
    let worker = db.site.worker_name.clone();
    let workers_dev = zwa_core::deploy::workers_dev_url(&db.client, &account, &worker).await?;

    // Sitemap/RSS need an absolute URL; fall back to workers.dev.
    let site_url = db
        .d1()
        .setting(zwa_site::keys::URL)
        .await?
        .filter(|u| !u.is_empty());
    let hosts = zwa_core::turnstile::hosts(&workers_dev, site_url.as_deref());
    let forms = zwa_core::turnstile::backend(&db.client, &db.d1(), &hosts).await?;
    let auth = zwa_core::basic_auth::load(&db.d1()).await?;
    let options = BuildOptions {
        base_url: site_url.is_none().then(|| workers_dev.clone()),
        theme_files: crate::theme::load_files(app, db, false).await?,
        ..Default::default()
    };
    // Before the data is read, so edits saved during the upload stay "not reflected".
    let snapshot_at = db.d1().now().await?;
    log::info!("publish: building {worker} for {}", site_url.as_deref().unwrap_or(&workers_dev));
    let build = build_to_dir(app, db, "publish", &options).await?;
    for w in &build.warnings {
        log::warn!("publish: {w}");
    }
    let summary = zwa_core::deploy::deploy_dir(
        &db.client,
        &account,
        &worker,
        &build.dir,
        forms.as_ref(),
        auth.as_ref(),
    )
    .await?;
    db.d1().mark_published(&snapshot_at).await?;
    Ok(PublishResult {
        url: format!("{workers_dev}/"),
        files: summary.files,
        uploaded: summary.uploaded,
        warnings: build.warnings,
    })
}

#[derive(Serialize)]
pub struct PublishStatus {
    /// When the site was last published (`zwa.published_at`), if ever.
    published_at: Option<String>,
    /// Published posts and pages saved since then, and scheduled ones that
    /// became due: the next publish puts them on the site.
    pending: Vec<PendingPost>,
    /// Site settings or the theme changed since then.
    settings_changed: bool,
}

#[derive(Serialize, Deserialize)]
pub struct PendingPost {
    id: i64,
    #[serde(rename = "type")]
    kind: String,
    title: String,
}

/// What the site does not show yet. Drafts are not counted, so a post turned
/// back into a draft stays on the site until the next publish without being
/// listed here.
#[tauri::command]
pub async fn publish_status(app: AppHandle) -> Result<PublishStatus> {
    let db = Db::open(&app)?;
    let published_at = db.d1().setting(zwa_core::d1::PUBLISHED_AT).await?;
    let at = serde_json::json!(published_at);
    let pending = db
        .rows(
            &format!(
                "SELECT id, type, title FROM posts
                  WHERE status = 'published'
                    AND (published_at IS NULL OR published_at <= {NOW})
                    AND (?1 IS NULL OR updated_at > ?1 OR published_at > ?1)
                  ORDER BY updated_at DESC"
            ),
            std::slice::from_ref(&at),
        )
        .await?;
    #[derive(Deserialize)]
    struct Count {
        n: i64,
    }
    let settings_changed = published_at.is_some()
        && db
            .rows::<Count>(
                "SELECT COUNT(*) AS n FROM settings
                  WHERE updated_at > ?1 AND key NOT IN (?2, ?3) AND key NOT LIKE 'ai.%' AND key NOT LIKE 'github.%'",
                &[
                    at,
                    serde_json::json!(zwa_core::d1::PUBLISHED_AT),
                    serde_json::json!(zwa_core::publish_lock::KEY),
                ],
            )
            .await?
            .first()
            .is_some_and(|c| c.n > 0);
    Ok(PublishStatus {
        published_at,
        pending,
        settings_changed,
    })
}
