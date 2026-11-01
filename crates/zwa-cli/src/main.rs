//! `zwa`: build and publish a ZWA CMS site from the command line, e.g. on a
//! schedule in GitHub Actions (which also publishes scheduled posts).
//!
//! ```text
//! zwa build      --site <site-id> [--out <dir>] [--drafts]
//! zwa publish    --site <site-id>
//! zwa theme push --site <site-id> --dir <dir>
//! ```
//!
//! `theme push` saves a theme folder to the site's R2 (what the app's
//! "upload from folder" does), e.g. from a theme kept in a repository.
//!
//! Credentials come from the environment:
//! - `CLOUDFLARE_API_TOKEN`: an API token with D1 / Workers R2 Storage /
//!   Workers Scripts edit permissions (an account API token suits CI)
//! - `CLOUDFLARE_ACCOUNT_ID`

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use zwa_core::cloudflare::Client;
use zwa_core::d1::D1;
use zwa_core::{Error, Result};
use zwa_site::BuildOptions;

const USAGE: &str = "使い方:
  zwa build      --site <サイトID> [--out <出力先>] [--drafts]
  zwa publish    --site <サイトID>
  zwa theme push --site <サイトID> --dir <テーマのフォルダ>

環境変数:
  CLOUDFLARE_API_TOKEN   Cloudflare の API トークン
  CLOUDFLARE_ACCOUNT_ID  Cloudflare のアカウント ID";

struct Args {
    command: String,
    site: String,
    out: PathBuf,
    drafts: bool,
    dir: Option<PathBuf>,
}

fn parse_args() -> std::result::Result<Args, String> {
    let mut it = std::env::args().skip(1);
    let mut command = it.next().ok_or("コマンドを指定してください")?;
    if command == "theme" {
        match it.next().as_deref() {
            Some("push") => command = "theme push".into(),
            _ => return Err("theme の後に push を指定してください".into()),
        }
    }
    if !matches!(command.as_str(), "build" | "publish" | "theme push") {
        return Err(format!("不明なコマンドです: {command}"));
    }
    let mut site = None;
    let mut out = PathBuf::from("dist");
    let mut drafts = false;
    let mut dir = None;
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--site" => site = it.next(),
            "--out" => out = it.next().ok_or("--out の値がありません")?.into(),
            "--drafts" => drafts = true,
            "--dir" => dir = Some(it.next().ok_or("--dir の値がありません")?.into()),
            _ => return Err(format!("不明な引数です: {arg}")),
        }
    }
    if command == "theme push" && dir.is_none() {
        return Err("--dir を指定してください".into());
    }
    Ok(Args {
        command,
        site: site.ok_or("--site を指定してください")?,
        out,
        drafts,
        dir,
    })
}

fn env(name: &str) -> Result<String> {
    std::env::var(name)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| Error::Invalid(format!("環境変数 {name} を設定してください")))
}

/// Cloudflare resources of a site, found from its site ID.
struct Site {
    database_id: String,
    r2_bucket: String,
    worker_name: String,
}

async fn find_site(client: &Client, account: &str, site_id: &str) -> Result<Site> {
    let name = format!("zwa-{site_id}");
    let db = client
        .d1_list(account)
        .await?
        .into_iter()
        .find(|d| d.name == name)
        .ok_or_else(|| Error::Invalid(format!("D1 データベース {name} が見つかりません")))?;
    let d1 = D1 {
        client,
        account_id: account,
        database_id: &db.uuid,
    };
    let mut values = Vec::new();
    for key in ["zwa.r2_bucket", "zwa.worker_name"] {
        values.push(d1.setting(key).await?.ok_or_else(|| {
            Error::Invalid(format!(
                "{name} は ZWA CMS のサイトではありません（{key} がありません）"
            ))
        })?);
    }
    let [r2_bucket, worker_name] = <[String; 2]>::try_from(values).unwrap();
    Ok(Site {
        r2_bucket,
        worker_name,
        database_id: db.uuid.clone(),
    })
}

/// Builds the site into `out` (replacing it). Returns the number of files.
async fn build(
    client: &Client,
    account: &str,
    site: &Site,
    out: &Path,
    mut options: BuildOptions,
) -> Result<usize> {
    let d1 = D1 {
        client,
        account_id: account,
        database_id: &site.database_id,
    };
    let data = d1.load_site_data().await?;
    options.theme_files = zwa_core::theme::download(&d1, &site.r2_bucket).await?;
    let output = zwa_site::build(&data, &options)
        .await
        .map_err(|e| Error::Invalid(e.to_string()))?;
    for w in &output.warnings {
        eprintln!("警告: {w}");
    }

    if out.exists() {
        std::fs::remove_dir_all(out)?;
    }
    for (path, bytes) in &output.files {
        zwa_core::write_file(out, path, bytes)?;
    }
    let max_width = zwa_core::images::max_width(&data.settings);
    for key in &output.media {
        match client.r2_get(account, &site.r2_bucket, key).await {
            Ok(bytes) => {
                let k = key.clone();
                let bytes = tokio::task::spawn_blocking(move || {
                    zwa_core::images::resize(&k, &bytes, max_width).unwrap_or(bytes)
                })
                .await
                .map_err(|e| Error::Invalid(e.to_string()))?;
                zwa_core::write_file(out, key, &bytes)?;
            }
            Err(e) => eprintln!("警告: /{key} を取得できません: {e}"),
        }
    }
    Ok(output.files.len() + output.media.len())
}

async fn run(args: Args) -> Result<()> {
    let client = Client::new(env("CLOUDFLARE_API_TOKEN")?);
    let account = env("CLOUDFLARE_ACCOUNT_ID")?;
    let site = find_site(&client, &account, &args.site).await?;

    match args.command.as_str() {
        "build" => {
            let options = BuildOptions {
                include_drafts: args.drafts,
                ..Default::default()
            };
            let files = build(&client, &account, &site, &args.out, options).await?;
            println!("{files} ファイルを {} に出力しました", args.out.display());
        }
        "theme push" => {
            let dir = args.dir.as_deref().unwrap_or(Path::new("theme"));
            let files = zwa_core::theme::read_dir(dir)?;
            let d1 = D1 {
                client: &client,
                account_id: &account,
                database_id: &site.database_id,
            };
            zwa_core::theme::upload(&d1, &site.r2_bucket, &files).await?;
            println!(
                "{} のテーマ（{} ファイル）を保存しました",
                dir.display(),
                files.len()
            );
        }
        _ => {
            let workers_dev =
                zwa_core::deploy::workers_dev_url(&client, &account, &site.worker_name).await?;
            let d1 = D1 {
                client: &client,
                account_id: &account,
                database_id: &site.database_id,
            };
            let lock = wait_for_lock(&d1).await?;
            let result = async {
                let site_url = d1
                    .setting(zwa_site::keys::URL)
                    .await?
                    .filter(|u| !u.is_empty());
                let hosts = zwa_core::turnstile::hosts(&workers_dev, site_url.as_deref());
                let forms = zwa_core::turnstile::backend(&client, &d1, &hosts).await?;
                let auth = zwa_core::basic_auth::load(&d1).await?;
                let options = BuildOptions {
                    base_url: site_url.is_none().then(|| workers_dev.clone()),
                    ..Default::default()
                };
                let snapshot_at = d1.now().await?;
                build(&client, &account, &site, &args.out, options).await?;
                let summary = zwa_core::deploy::deploy_dir(
                    &client,
                    &account,
                    &site.worker_name,
                    &args.out,
                    forms.as_ref(),
                    auth.as_ref(),
                )
                .await?;
                d1.mark_published(&snapshot_at).await?;
                println!(
                    "公開しました: {workers_dev}/（{} ファイル、うち {} 件を送信）",
                    summary.files, summary.uploaded
                );
                Ok::<(), zwa_core::Error>(())
            }
            .await;
            if let Err(e) = lock.release(&d1).await {
                eprintln!(
                    "公開中の印を消せませんでした（{} 分で自動的に無効になります）: {e}",
                    zwa_core::publish_lock::LEASE_MINUTES
                );
            }
            result?;
        }
    }
    Ok(())
}

/// Waits while the app (or another run) is publishing. A stale lock is
/// taken over after `LEASE_MINUTES`, so this ends by then.
async fn wait_for_lock(d1: &D1<'_>) -> Result<zwa_core::publish_lock::PublishLock> {
    use zwa_core::publish_lock::{Holder, PublishLock};
    let by = if std::env::var_os("GITHUB_ACTIONS").is_some() {
        Holder::GithubActions
    } else {
        Holder::Cli
    };
    loop {
        match PublishLock::acquire(d1, by).await? {
            Ok(lock) => return Ok(lock),
            Err(busy) => {
                println!("{} 30 秒後に確認します。", busy.message());
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            }
        }
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(a) => a,
        Err(msg) => {
            eprintln!("{msg}\n\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    match run(args).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("エラー: {e}");
            ExitCode::FAILURE
        }
    }
}
