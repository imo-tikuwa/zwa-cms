//! GitHub link: a repository per site with a workflow that publishes the
//! site, and a scheduler Worker that starts the workflow when a scheduled
//! post becomes due (`schedule.js`).
//!
//! The user makes the repository on GitHub from the template repository
//! (`TEMPLATE_REPO` in `src/lib/github.ts`), and one fine-grained token for only that
//! repository with Actions and Secrets write. The app sets the Actions
//! secrets with it, then keeps it only in the scheduler Worker: a leak can
//! run the workflow and overwrite (not read) the secrets, but not change
//! the workflow.
//!
//! The Actions workflow gets an account API token made here for it, so the
//! user's own Cloudflare token never leaves this PC.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use reqwest::multipart::{Form, Part};
use reqwest::{Method, StatusCode};
use serde::Serialize;
use serde_json::{Value, json};
use tauri::AppHandle;

use crate::db::{Db, NOW};
use crate::error::{Error, Result};

const API: &str = "https://api.github.com";
const WORKFLOW: &str = "zwa-publish.yml";
const SCHEDULE_JS: &str = include_str!("schedule.js");
const CRON: &str = "*/5 * * * *";
const COMPATIBILITY_DATE: &str = "2025-09-01";

/// `settings` keys (D1). `github.dispatched_at` / `github.dispatch_count` /
/// `github.dispatch_error` are written by the scheduler Worker.
mod keys {
    pub const REPO: &str = "github.repo";
    pub const BRANCH: &str = "github.branch";
    pub const CF_TOKEN_ID: &str = "github.cf_token_id";
    pub const SCHEDULE: &str = "github.schedule";
    pub const DISPATCHED_AT: &str = "github.dispatched_at";
    pub const DISPATCH_ERROR: &str = "github.dispatch_error";
}

/// Shown in the app when the user's Cloudflare token cannot make tokens.
pub const TOKENS_PERMISSION: &str = "Account · Account API Tokens · Edit";

struct GitHub {
    http: reqwest::Client,
    token: String,
}

impl GitHub {
    fn new(token: &str) -> Self {
        Self {
            http: reqwest::Client::new(),
            token: token.trim().to_string(),
        }
    }

    async fn send(&self, method: Method, path: &str, body: Option<Value>) -> Result<(StatusCode, Value)> {
        let mut req = self
            .http
            .request(method, format!("{API}{path}"))
            .bearer_auth(&self.token)
            .header("accept", "application/vnd.github+json")
            .header("x-github-api-version", "2022-11-28")
            .header("user-agent", "zwa-cms");
        if let Some(body) = body {
            req = req.json(&body);
        }
        let res = req.send().await?;
        let status = res.status();
        let text = res.text().await?;
        let value = if text.is_empty() {
            Value::Null
        } else {
            serde_json::from_str(&text).unwrap_or(Value::String(text))
        };
        Ok((status, value))
    }

    /// Like `send`, but any status other than 2xx is an error.
    async fn call(&self, method: Method, path: &str, body: Option<Value>) -> Result<Value> {
        let (status, value) = self.send(method, path, body).await?;
        if status.is_success() {
            Ok(value)
        } else {
            Err(api_error(status, &value))
        }
    }
}

fn api_error(status: StatusCode, body: &Value) -> Error {
    let message = body
        .get("message")
        .and_then(Value::as_str)
        .map(String::from)
        .unwrap_or_else(|| body.to_string());
    Error::Invalid(format!("GitHub API エラー（HTTP {status}）: {message}"))
}

fn str_field(v: &Value, key: &str) -> Result<String> {
    v.get(key)
        .and_then(Value::as_str)
        .map(String::from)
        .ok_or_else(|| Error::Invalid(format!("GitHub の応答に {key} がありません")))
}

#[derive(Serialize)]
pub struct GitHubStatus {
    /// `owner/name` when linked.
    repo: Option<String>,
    /// Name of the scheduler Worker when scheduled posts are on.
    schedule: Option<String>,
    /// The site has been published (the scheduler needs that first).
    published: bool,
    /// Forms are on: the Actions token also needs Turnstile.
    forms: bool,
    dispatched_at: Option<String>,
    dispatch_error: Option<String>,
    /// Before linking: the user's Cloudflare token can make tokens (the
    /// link makes one for Actions). None once linked.
    can_make_tokens: Option<bool>,
}

async fn setting(db: &Db, key: &str) -> Result<Option<String>> {
    Ok(db.d1().setting(key).await?.filter(|v| !v.is_empty()))
}

async fn set_setting(db: &Db, key: &str, value: &str) -> Result<()> {
    db.query(
        &format!(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = {NOW}"
        ),
        &[json!(key), json!(value)],
    )
    .await?;
    Ok(())
}

async fn link_status(db: &Db) -> Result<GitHubStatus> {
    let repo = setting(db, keys::REPO).await?;
    let can_make_tokens = if repo.is_none() {
        Some(can_make_tokens(db).await)
    } else {
        None
    };
    Ok(GitHubStatus {
        repo,
        can_make_tokens,
        schedule: setting(db, keys::SCHEDULE).await?,
        published: setting(db, zwa_core::d1::PUBLISHED_AT).await?.is_some(),
        forms: setting(db, zwa_core::turnstile::SITEKEY).await?.is_some(),
        dispatched_at: setting(db, keys::DISPATCHED_AT).await?,
        dispatch_error: setting(db, keys::DISPATCH_ERROR).await?,
    })
}

/// Listing the account's tokens needs the Account API Tokens permission.
async fn can_make_tokens(db: &Db) -> bool {
    db.client
        .get_json::<Value>(&format!("/accounts/{}/tokens?per_page=1", db.site.account_id))
        .await
        .is_ok()
}

#[tauri::command]
pub async fn github_status(app: AppHandle) -> Result<GitHubStatus> {
    link_status(&Db::open(&app)?).await
}

#[derive(Serialize)]
pub struct TokenCheck {
    /// The GitHub user the token belongs to.
    login: String,
    /// A fine-grained token (`github_pat_`), not a classic one.
    fine_grained: bool,
    /// When the token expires (GitHub's header), if it does.
    expires_at: Option<String>,
}

/// What can be checked before using a token. GitHub has no API that lists
/// a fine-grained token's permissions, so those show up only when used.
#[tauri::command]
pub async fn github_check_token(token: String) -> Result<TokenCheck> {
    let gh = GitHub::new(&token);
    let res = gh
        .http
        .get(format!("{API}/user"))
        .bearer_auth(&gh.token)
        .header("accept", "application/vnd.github+json")
        .header("x-github-api-version", "2022-11-28")
        .header("user-agent", "zwa-cms")
        .send()
        .await?;
    let status = res.status();
    let expires_at = res
        .headers()
        .get("github-authentication-token-expiration")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(Error::Invalid(format!(
            "トークンを確認できません。コピーし損ねていないか確認してください（{}）",
            api_error(status, &body)
        )));
    }
    Ok(TokenCheck {
        login: str_field(&body, "login")?,
        fine_grained: gh.token.starts_with("github_pat_"),
        expires_at,
    })
}

/// Makes an account API token for the Actions workflow (the permissions
/// `zwa publish` needs) and returns its value. A token made by an earlier
/// link is deleted first.
async fn create_actions_token(db: &Db, repo: &str) -> Result<String> {
    let account = &db.site.account_id;
    let permission_error = |e: zwa_core::Error| -> Error {
        if zwa_core::turnstile::is_permission_error(&e) {
            Error::Invalid(format!(
                "GitHub Actions 用の Cloudflare トークンを作れません。アプリで使っているユーザー API トークンに {TOKENS_PERMISSION} の権限を追加してください（{e}）"
            ))
        } else {
            e.into()
        }
    };
    let groups: Vec<Value> = db
        .client
        .get_json(&format!("/accounts/{account}/tokens/permission_groups"))
        .await
        .map_err(permission_error)?;
    let forms = setting(db, zwa_core::turnstile::SITEKEY).await?.is_some();
    // Names as the API lists them ("Write" is "Edit" in the dashboard).
    let mut wanted = vec![
        ("D1", &["D1 Write"][..]),
        ("Workers R2 Storage", &["Workers R2 Storage Write"][..]),
        ("Workers Scripts", &["Workers Scripts Write"][..]),
    ];
    if forms {
        wanted.push(("Turnstile", &["Turnstile Sites Write", "Turnstile Write"][..]));
    }
    let mut ids = Vec::new();
    for (label, names) in &wanted {
        let id = groups
            .iter()
            .find(|g| g["name"].as_str().is_some_and(|n| names.contains(&n)))
            .and_then(|g| g["id"].as_str())
            .ok_or_else(|| Error::Invalid(format!("Cloudflare の権限「{label}」が見つかりません")))?;
        ids.push(json!({ "id": id }));
    }

    if let Some(old) = setting(db, keys::CF_TOKEN_ID).await? {
        // Best effort: it may have been deleted on the dashboard.
        if let Err(e) = cf_delete(db, &format!("/accounts/{account}/tokens/{old}")).await {
            log::warn!("github: could not delete the previous Actions token: {e}");
        }
    }
    let created: Value = db
        .client
        .post_json(
            &format!("/accounts/{account}/tokens"),
            json!({
                "name": format!("ZWA CMS GitHub Actions ({repo})"),
                "policies": [{
                    "effect": "allow",
                    "resources": { format!("com.cloudflare.api.account.{account}"): "*" },
                    "permission_groups": ids,
                }],
            }),
        )
        .await
        .map_err(permission_error)?;
    set_setting(db, keys::CF_TOKEN_ID, &str_field(&created, "id")?).await?;
    str_field(&created, "value")
}

/// DELETE that also accepts a reply without a result.
async fn cf_delete(db: &Db, path: &str) -> Result<()> {
    match db.client.delete_json::<Value>(path).await {
        Ok(_) => Ok(()),
        Err(zwa_core::Error::Cloudflare(m)) if m == "result がありません" => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// Encrypts with the repository's public key (libsodium sealed box) and
/// saves an Actions secret.
async fn put_secret(gh: &GitHub, repo: &str, key: &Value, name: &str, value: &str) -> Result<()> {
    let key_bytes: [u8; 32] = STANDARD
        .decode(str_field(key, "key")?)
        .ok()
        .and_then(|b| b.try_into().ok())
        .ok_or_else(|| Error::Invalid("リポジトリの公開鍵を読み取れません".into()))?;
    let sealed = crypto_box::PublicKey::from(key_bytes)
        .seal(&mut crypto_box::aead::OsRng, value.as_bytes())
        .map_err(|_| Error::Invalid("シークレットを暗号化できません".into()))?;
    gh.call(
        Method::PUT,
        &format!("/repos/{repo}/actions/secrets/{name}"),
        Some(json!({ "encrypted_value": STANDARD.encode(sealed), "key_id": str_field(key, "key_id")? })),
    )
    .await?;
    Ok(())
}

fn schedule_worker(db: &Db) -> String {
    format!("{}-schedule", db.site.worker_name)
}

/// Links the repository the user made from the template: checks the token
/// can reach it, sets the Actions secrets, then uploads the scheduler Worker
/// with the token as a secret and sets its Cron Trigger. Linking again
/// (e.g. with a new token) replaces all of it.
#[tauri::command]
pub async fn github_link(app: AppHandle, token: String, repo: String) -> Result<GitHubStatus> {
    let db = Db::open(&app)?;
    let gh = GitHub::new(&token);
    let repo = repo.trim().trim_matches('/');
    let valid = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
    let repo = match repo.split_once('/') {
        Some((owner, name)) if valid(owner) && valid(name) => repo.to_string(),
        None if valid(repo) => format!("{}/{repo}", str_field(&gh.call(Method::GET, "/user", None).await?, "login")?),
        _ => {
            return Err(Error::Invalid(
                "リポジトリ名は英数字・ハイフン・アンダースコア・ピリオドで入力してください".into(),
            ));
        }
    };
    log::info!("github: linking {repo}");

    let (status, body) = gh.send(Method::GET, &format!("/repos/{repo}"), None).await?;
    if !status.is_success() {
        return Err(Error::Invalid(format!(
            "{repo} を読めません。リポジトリ名と、トークンの Repository access に {repo} が入っているか確認してください（{}）",
            api_error(status, &body)
        )));
    }
    let full_name = str_field(&body, "full_name")?;
    let branch = str_field(&body, "default_branch")?;
    let (status, body) = gh
        .send(Method::GET, &format!("/repos/{full_name}/actions/workflows/{WORKFLOW}"), None)
        .await?;
    match status {
        s if s.is_success() => {}
        StatusCode::NOT_FOUND => {
            return Err(Error::Invalid(format!(
                "{full_name} に .github/workflows/{WORKFLOW} がありません。テンプレートから作ったリポジトリか確認してください"
            )));
        }
        StatusCode::FORBIDDEN => {
            return Err(Error::Invalid(format!(
                "{}\nトークンに Actions（Read and write）の権限があるか確認してください",
                api_error(status, &body)
            )));
        }
        s => return Err(api_error(s, &body)),
    }
    // Checked before the Cloudflare token is made, so a missing permission
    // does not leave a token behind.
    let (status, key) = gh
        .send(Method::GET, &format!("/repos/{full_name}/actions/secrets/public-key"), None)
        .await?;
    if !status.is_success() {
        return Err(Error::Invalid(format!(
            "{}\nトークンに Secrets（Read and write）の権限があるか確認してください",
            api_error(status, &key)
        )));
    }

    let cf_token = create_actions_token(&db, &full_name).await?;
    put_secret(&gh, &full_name, &key, "CLOUDFLARE_API_TOKEN", &cf_token).await?;
    put_secret(&gh, &full_name, &key, "CLOUDFLARE_ACCOUNT_ID", &db.site.account_id).await?;
    put_secret(&gh, &full_name, &key, "ZWA_SITE_ID", &db.site.id).await?;

    let name = schedule_worker(&db);
    let account = &db.site.account_id;
    let metadata = json!({
        "main_module": "schedule.js",
        "compatibility_date": COMPATIBILITY_DATE,
        "bindings": [
            { "name": "DB", "type": "d1", "database_id": db.site.d1_database_id },
            { "name": "GITHUB_TOKEN", "type": "secret_text", "text": gh.token },
            { "name": "GITHUB_REPO", "type": "plain_text", "text": full_name },
            { "name": "GITHUB_BRANCH", "type": "plain_text", "text": branch },
            { "name": "WORKFLOW", "type": "plain_text", "text": WORKFLOW },
        ],
    });
    let form = Form::new()
        .part("metadata", Part::text(metadata.to_string()).mime_str("application/json").unwrap())
        .part(
            "schedule.js",
            Part::text(SCHEDULE_JS)
                .file_name("schedule.js")
                .mime_str("application/javascript+module")
                .unwrap(),
        );
    // The metadata carries the token; never log it.
    log::info!("github: uploading the scheduler Worker {name}");
    let _: Value = db
        .client
        .multipart(Method::PUT, &format!("/accounts/{account}/workers/scripts/{name}"), form, None)
        .await?;
    let _: Value = db
        .client
        .put_json(
            &format!("/accounts/{account}/workers/scripts/{name}/schedules"),
            json!([{ "cron": CRON }]),
        )
        .await?;

    set_setting(&db, keys::REPO, &full_name).await?;
    set_setting(&db, keys::BRANCH, &branch).await?;
    set_setting(&db, keys::SCHEDULE, &name).await?;
    log::info!("github: linked {full_name}");
    link_status(&db).await
}
/// Undoes the link: removes the scheduler Worker and the Actions token,
/// and forgets the repository. The repository itself is left on GitHub.
#[tauri::command]
pub async fn github_unlink(app: AppHandle) -> Result<GitHubStatus> {
    let db = Db::open(&app)?;
    let account = &db.site.account_id;
    if let Some(name) = setting(&db, keys::SCHEDULE).await? {
        match cf_delete(&db, &format!("/accounts/{account}/workers/scripts/{name}")).await {
            // 10007: already gone.
            Err(Error::Cloudflare(m)) if !m.contains("10007") => return Err(Error::Cloudflare(m)),
            _ => {}
        }
    }
    if let Some(id) = setting(&db, keys::CF_TOKEN_ID).await?
        && let Err(e) = cf_delete(&db, &format!("/accounts/{account}/tokens/{id}")).await
    {
        log::warn!("github: could not delete the Actions token {id}: {e}");
    }
    db.query("DELETE FROM settings WHERE key LIKE 'github.%'", &[]).await?;
    log::info!("github: unlinked");
    link_status(&db).await
}
