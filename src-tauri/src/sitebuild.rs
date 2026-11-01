//! Builds the current site with `zwa-site` and serves a local preview.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use axum::Router;
use axum::routing::get;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tokio::sync::{Mutex, RwLock};
use tower::ServiceExt;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;
use zwa_site::BuildOptions;

use crate::db::Db;
use crate::error::{Error, Result};
use crate::media;
use crate::settings::Site;

#[derive(Serialize)]
pub struct BuildResult {
    pub dir: PathBuf,
    pub files: usize,
    pub warnings: Vec<String>,
}

pub fn output_dir(app: &AppHandle, site: &Site, name: &str) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_local_data_dir()?
        .join("sites")
        .join(&site.d1_database_id)
        .join(name))
}

/// Builds into `<app data>/sites/<db id>/<name>`, replacing its contents,
/// and copies referenced media from R2 (via the local cache).
pub async fn build_to_dir(
    app: &AppHandle,
    db: &Db,
    name: &str,
    options: &BuildOptions,
) -> Result<BuildResult> {
    let started = std::time::Instant::now();
    let data = db.d1().load_site_data().await?;
    log::info!("build {name}: loaded site data in {:.1}s", started.elapsed().as_secs_f32());
    let output = zwa_site::build(&data, options)
        .await
        .map_err(|e| Error::Invalid(e.to_string()))?;
    log::info!(
        "build {name}: generated {} files, {} media to fetch ({:.1}s)",
        output.files.len(),
        output.media.len(),
        started.elapsed().as_secs_f32()
    );
    let dir = output_dir(app, &db.site, name)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    let mut warnings = output.warnings;
    let mut count = 0;
    for (path, bytes) in &output.files {
        zwa_core::write_file(&dir, path, bytes)?;
        count += 1;
    }
    let max_width = zwa_core::images::max_width(&data.settings);
    for key in &output.media {
        match media::read_object(app, &db.site, key).await {
            Ok(bytes) => {
                let bytes = crate::images::for_site(app, &db.site, key, bytes, max_width).await;
                zwa_core::write_file(&dir, key, &bytes)?;
                count += 1;
            }
            Err(e) => warnings.push(format!("/{key} を取得できません: {e}")),
        }
    }
    log::info!("build {name}: {count} files in {} ({:.1}s)", dir.display(), started.elapsed().as_secs_f32());
    Ok(BuildResult {
        dir,
        files: count,
        warnings,
    })
}

/// Local preview server. Started on first use and kept running; each
/// build swaps the served directory and bumps the build id so open pages
/// reload themselves.
#[derive(Default)]
pub struct Preview {
    server: Mutex<Option<PreviewServer>>,
    /// The app's light/dark and brightness as JSON, which preview pages
    /// follow (`/__zwa/appearance`, see the default theme's base.html).
    appearance: Arc<std::sync::RwLock<String>>,
}

struct PreviewServer {
    addr: SocketAddr,
    dir: Arc<RwLock<PathBuf>>,
    build_id: Arc<AtomicU64>,
}

async fn start_server(dir: PathBuf, appearance: Arc<std::sync::RwLock<String>>) -> Result<PreviewServer> {
    let dir = Arc::new(RwLock::new(dir));
    let build_id = Arc::new(AtomicU64::new(1));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;

    let id = build_id.clone();
    let serve_dir = dir.clone();
    let app = Router::new()
        .route(
            "/__zwa/build",
            get(move || async move { id.load(Ordering::SeqCst).to_string() }),
        )
        .route(
            "/__zwa/appearance",
            get(move || async move {
                let json = appearance.read().unwrap().clone();
                (
                    [
                        (axum::http::header::CONTENT_TYPE, "application/json"),
                        (axum::http::header::CACHE_CONTROL, "no-store"),
                    ],
                    if json.is_empty() { "{}".to_string() } else { json },
                )
            }),
        )
        .fallback(move |req: axum::extract::Request| {
            let dir = serve_dir.clone();
            async move {
                let dir = dir.read().await.clone();
                ServeDir::new(&dir)
                    .not_found_service(ServeFile::new(dir.join("404.html")))
                    .oneshot(req)
                    .await
            }
        })
        // Pages, CSS and JS change with every rebuild; never reuse an old copy.
        .layer(SetResponseHeaderLayer::overriding(
            axum::http::header::CACHE_CONTROL,
            axum::http::HeaderValue::from_static("no-store"),
        ));
    tauri::async_runtime::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("preview server stopped: {e}");
        }
    });
    Ok(PreviewServer {
        addr,
        dir,
        build_id,
    })
}

#[derive(Serialize)]
pub struct PreviewResult {
    url: String,
    files: usize,
    warnings: Vec<String>,
}

#[tauri::command]
pub async fn preview_build(app: AppHandle, preview: State<'_, Preview>) -> Result<PreviewResult> {
    let db = Db::open(&app)?;
    let options = BuildOptions {
        include_drafts: true,
        live_reload: true,
        theme_files: crate::theme::load_files(&app, &db, true).await?,
        ..Default::default()
    };
    let result = build_to_dir(&app, &db, "preview", &options).await?;

    let mut server = preview.server.lock().await;
    match server.as_ref() {
        Some(s) => {
            *s.dir.write().await = result.dir.clone();
            s.build_id.fetch_add(1, Ordering::SeqCst);
        }
        None => *server = Some(start_server(result.dir.clone(), preview.appearance.clone()).await?),
    }
    Ok(PreviewResult {
        url: format!("http://{}/", server.as_ref().unwrap().addr),
        files: result.files,
        warnings: result.warnings,
    })
}

#[derive(Serialize, serde::Deserialize)]
pub struct Appearance {
    /// "system", "light" or "dark".
    mode: String,
    /// -1, 0 or 1.
    brightness: i8,
    /// What "system" resolves to in the app right now.
    scheme: String,
}

/// Remembers the app's appearance for preview pages to follow.
#[tauri::command]
pub fn preview_set_appearance(preview: State<'_, Preview>, appearance: Appearance) -> Result<()> {
    *preview.appearance.write().unwrap() = serde_json::to_string(&appearance)?;
    Ok(())
}

/// URL of the running preview, if any (so the UI can rebuild after saves).
#[tauri::command]
pub async fn preview_url(preview: State<'_, Preview>) -> Result<Option<String>> {
    Ok(preview
        .server
        .lock()
        .await
        .as_ref()
        .map(|s| format!("http://{}/", s.addr)))
}
