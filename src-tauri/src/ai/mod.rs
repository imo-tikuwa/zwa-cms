//! AI assistance with Claude: proofreading, excerpts, title/slug ideas,
//! tag/category suggestions, whole drafts, and user-defined prompts.
//!
//! Prompts and output parsing live here; `anthropic` only transports them.
//! Per-site settings (model, writing guidelines, custom prompts) are stored
//! in the site's D1 `settings` table so every machine uses the same ones.

pub(crate) mod anthropic;

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, State};

use crate::db::{Db, NOW};
use crate::error::{Error, Result};
use crate::migrations;
use crate::tray;

const KEY_MODEL: &str = "ai.model";
const KEY_GUIDELINES: &str = "ai.guidelines";
const KEY_PROMPTS: &str = "ai.prompts";

/// Event carrying streamed text: `{ request_id, text }`.
const EVENT_DELTA: &str = "ai-delta";

/// A user-defined prompt.
#[derive(Clone, Serialize, Deserialize)]
pub struct CustomPrompt {
    id: String,
    name: String,
    prompt: String,
    /// "body": the result replaces the body (shown as a diff first);
    /// "panel": the result is only shown.
    target: String,
}

#[derive(Serialize, Deserialize)]
pub struct AiSettings {
    /// Empty: follow this PC's default model (app settings).
    model: String,
    guidelines: String,
    prompts: Vec<CustomPrompt>,
}

#[derive(Serialize)]
pub struct AiStatus {
    has_key: bool,
    /// This PC's default model, used by sites that don't choose one.
    default_model: &'static str,
    models: Vec<&'static str>,
}

/// What the editor sends along with a task.
#[derive(Deserialize)]
pub struct PostContext {
    title: String,
    body: String,
    body_format: String,
    /// Existing categories and tags, so suggestions can reuse them.
    #[serde(default)]
    categories: Vec<String>,
    #[serde(default)]
    tags: Vec<String>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Task {
    Proofread,
    Excerpt,
    TitleSlug,
    Terms,
    /// Whole draft from a topic or notes.
    Article {
        brief: String,
    },
    Custom {
        prompt_id: String,
    },
}

/// Running requests, so they can be cancelled.
#[derive(Default)]
pub struct Running(Mutex<HashMap<String, tokio::task::AbortHandle>>);

async fn read_settings(db: &Db) -> Result<AiSettings> {
    let rows = db
        .query(
            "SELECT key, value FROM settings WHERE key IN (?1, ?2, ?3)",
            &[json!(KEY_MODEL), json!(KEY_GUIDELINES), json!(KEY_PROMPTS)],
        )
        .await?
        .results;
    let get = |k: &str| {
        rows.iter()
            .find(|r| r["key"] == k)
            .and_then(|r| r["value"].as_str().map(String::from))
    };
    Ok(AiSettings {
        model: get(KEY_MODEL)
            .filter(|m| anthropic::MODELS.contains(&m.as_str()))
            .unwrap_or_default(),
        guidelines: get(KEY_GUIDELINES).unwrap_or_default(),
        prompts: get(KEY_PROMPTS)
            .and_then(|p| serde_json::from_str(&p).ok())
            .unwrap_or_default(),
    })
}

/// The PC's default model (app settings), else the built-in one.
fn default_model(app: &AppHandle) -> &'static str {
    let chosen = crate::settings::load(app)
        .ok()
        .and_then(|s| s.ai_default_model);
    anthropic::MODELS
        .iter()
        .copied()
        .find(|m| chosen.as_deref() == Some(*m))
        .unwrap_or(anthropic::DEFAULT_MODEL)
}

#[tauri::command]
pub fn ai_status(app: AppHandle) -> Result<AiStatus> {
    Ok(AiStatus {
        has_key: anthropic::load_key()?.is_some(),
        default_model: default_model(&app),
        models: anthropic::MODELS.to_vec(),
    })
}

#[tauri::command]
pub fn ai_set_default_model(app: AppHandle, model: String) -> Result<AiStatus> {
    if !anthropic::MODELS.contains(&model.as_str()) {
        return Err(Error::Invalid("対応していないモデルです".into()));
    }
    let mut s = crate::settings::load(&app)?;
    s.ai_default_model = Some(model);
    crate::settings::save(&app, &s)?;
    ai_status(app)
}

#[tauri::command]
pub async fn ai_set_key(app: AppHandle, key: String) -> Result<AiStatus> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err(Error::Invalid("API キーを入力してください".into()));
    }
    anthropic::verify_key(&key).await?;
    anthropic::save_key(&key)?;
    ai_status(app)
}

#[tauri::command]
pub fn ai_delete_key(app: AppHandle) -> Result<AiStatus> {
    anthropic::delete_key()?;
    ai_status(app)
}

#[tauri::command]
pub async fn ai_settings_get(app: AppHandle) -> Result<AiSettings> {
    read_settings(&Db::open(&app)?).await
}

#[tauri::command]
pub async fn ai_settings_save(app: AppHandle, settings: AiSettings) -> Result<()> {
    if !settings.model.is_empty() && !anthropic::MODELS.contains(&settings.model.as_str()) {
        return Err(Error::Invalid("対応していないモデルです".into()));
    }
    for p in &settings.prompts {
        if p.name.trim().is_empty() || p.prompt.trim().is_empty() {
            return Err(Error::Invalid(
                "プロンプトの名前と内容を入力してください".into(),
            ));
        }
        if !matches!(p.target.as_str(), "body" | "panel") {
            return Err(Error::Invalid("不正な反映先です".into()));
        }
    }
    let db = Db::open(&app)?;
    if settings.model.is_empty() {
        db.query("DELETE FROM settings WHERE key = ?1", &[json!(KEY_MODEL)])
            .await?;
    }
    let mut values = vec![
        (KEY_GUIDELINES, settings.guidelines.clone()),
        (KEY_PROMPTS, serde_json::to_string(&settings.prompts)?),
    ];
    if !settings.model.is_empty() {
        values.push((KEY_MODEL, settings.model.clone()));
    }
    for (key, value) in values {
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

// ---------- Prompts ----------

const BASE_SYSTEM: &str = "あなたはブログ・Web サイトの編集者として、執筆者を手伝います。\
指示された形式だけを出力し、前置きや説明は付けないでください。";

fn system_prompt(guidelines: &str) -> String {
    if guidelines.trim().is_empty() {
        BASE_SYSTEM.to_string()
    } else {
        format!(
            "{BASE_SYSTEM}\n\nこのサイトの執筆方針:\n{}",
            guidelines.trim()
        )
    }
}

fn post_block(p: &PostContext) -> String {
    let format = if p.body_format == "html" {
        "HTML"
    } else {
        "Markdown"
    };
    format!(
        "<title>{}</title>\n<body format=\"{format}\">\n{}\n</body>",
        p.title, p.body
    )
}

struct Plan {
    user: String,
    effort: &'static str,
    max_tokens: u32,
    schema: Option<Value>,
}

fn strings_schema(fields: &[&str]) -> Value {
    let props: serde_json::Map<String, Value> = fields
        .iter()
        .map(|f| {
            (
                (*f).to_string(),
                json!({ "type": "array", "items": { "type": "string" } }),
            )
        })
        .collect();
    json!({ "type": "object", "properties": props, "required": fields, "additionalProperties": false })
}

fn plan(task: &Task, post: &PostContext, settings: &AiSettings) -> Result<Plan> {
    let block = post_block(post);
    let keep_format = if post.body_format == "html" {
        "HTML のタグや属性はそのまま残してください。"
    } else {
        "Markdown の記法（見出し、リスト、リンク、画像の記述など）はそのまま残してください。"
    };
    Ok(match task {
        Task::Proofread => Plan {
            user: format!(
                "次の記事の本文を添削してください。誤字脱字、表記ゆれ、文法の誤り、分かりにくい表現を直します。\
内容や構成、文体は変えず、必要な箇所だけ直してください。{keep_format}\
直した本文だけを出力してください。\n\n{block}"
            ),
            effort: "medium",
            max_tokens: 64000,
            schema: None,
        },
        Task::Excerpt => Plan {
            user: format!(
                "次の記事の抜粋（記事一覧や検索結果に表示する紹介文）を、日本語で 80〜120 文字程度で作ってください。\
読みたくなるように、記事の要点を伝えてください。\n\n{block}"
            ),
            effort: "low",
            max_tokens: 4000,
            schema: Some(json!({
                "type": "object",
                "properties": { "excerpt": { "type": "string" } },
                "required": ["excerpt"],
                "additionalProperties": false
            })),
        },
        Task::TitleSlug => Plan {
            user: format!(
                "次の記事に合うタイトルの候補を 5 つと、URL 用のスラッグの候補を 5 つ考えてください。\
スラッグは英小文字・数字・ハイフンだけで、内容が分かる短い英語にしてください。\n\n{block}"
            ),
            effort: "low",
            max_tokens: 4000,
            schema: Some(strings_schema(&["titles", "slugs"])),
        },
        Task::Terms => Plan {
            user: format!(
                "次の記事に合うカテゴリーとタグを提案してください。\n\
カテゴリーは既存のものから 1〜2 個だけ選んでください（合うものがなければ空）。\n\
タグは既存のものを優先し、足りなければ新しいタグを提案してください（合計 3〜6 個）。\n\n\
<existing_categories>{}</existing_categories>\n<existing_tags>{}</existing_tags>\n\n{block}",
                post.categories.join(", "),
                post.tags.join(", ")
            ),
            effort: "low",
            max_tokens: 4000,
            schema: Some(strings_schema(&["categories", "tags"])),
        },
        Task::Article { brief } => Plan {
            user: format!(
                "次のテーマ・メモをもとに、ブログ記事の下書きを書いてください。\n\
本文は Markdown で、見出し（## から）や箇条書きを使って読みやすく構成してください。\
タイトル・スラッグ（英小文字・数字・ハイフン）・抜粋（80〜120 文字）・タグ（3〜6 個）も付けてください。\
既存のタグに合うものがあれば優先して使ってください。\n\n\
<existing_tags>{}</existing_tags>\n<brief>\n{}\n</brief>",
                post.tags.join(", "),
                brief.trim()
            ),
            effort: "high",
            max_tokens: 64000,
            schema: Some(json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "slug": { "type": "string" },
                    "excerpt": { "type": "string" },
                    "body": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["title", "slug", "excerpt", "body", "tags"],
                "additionalProperties": false
            })),
        },
        Task::Custom { prompt_id } => {
            let p = settings
                .prompts
                .iter()
                .find(|p| &p.id == prompt_id)
                .ok_or_else(|| Error::Invalid("プロンプトが見つかりません".into()))?;
            let output = if p.target == "body" {
                format!(
                    "結果は記事の本文として置き換えます。{keep_format}本文だけを出力してください。"
                )
            } else {
                "結果は執筆者が読むメモとして表示します。".into()
            };
            Plan {
                user: format!("{}\n\n{output}\n\n{block}", p.prompt.trim()),
                effort: "medium",
                max_tokens: 64000,
                schema: None,
            }
        }
    })
}

/// Runs a task. Text deltas are emitted as `ai-delta` events tagged with
/// `request_id`; the final result is returned (parsed JSON for structured
/// tasks, `{ "text": ... }` otherwise).
#[tauri::command]
pub async fn ai_run(
    app: AppHandle,
    running: State<'_, Running>,
    request_id: String,
    task: Task,
    post: PostContext,
) -> Result<Value> {
    let key = anthropic::load_key()?.ok_or_else(|| {
        Error::Invalid(
            "Claude の API キーが登録されていません（タイトルバーの歯車の「アプリの設定」で登録できます）".into(),
        )
    })?;
    let db = Db::open(&app)?;
    let mut settings = read_settings(&db).await?;
    if settings.model.is_empty() {
        settings.model = default_model(&app).into();
    }
    let plan = plan(&task, &post, &settings)?;
    let label = task_label(&task, &settings);
    let system = system_prompt(&settings.guidelines);
    let structured = plan.schema.is_some();

    let id = request_id.clone();
    let emitter = app.clone();
    let handle = tokio::spawn(async move {
        anthropic::stream(
            &key,
            anthropic::Request {
                model: &settings.model,
                system: &system,
                user: plan.user,
                effort: plan.effort,
                max_tokens: plan.max_tokens,
                schema: plan.schema,
            },
            |text| {
                let _ = emitter.emit(EVENT_DELTA, json!({ "request_id": id, "text": text }));
            },
        )
        .await
    });
    running
        .0
        .lock()
        .unwrap()
        .insert(request_id.clone(), handle.abort_handle());
    let result = handle.await;
    running.0.lock().unwrap().remove(&request_id);

    let output = match result {
        Ok(r) => r,
        Err(e) if e.is_cancelled() => return Err(Error::Invalid("中止しました".into())),
        Err(e) => Err(Error::Invalid(e.to_string())),
    };
    if let Ok(o) = &output {
        record_usage(&app, &db, o).await;
    }
    let value = output.and_then(|o| o.into_text()).and_then(|text| {
        if structured {
            serde_json::from_str(&text)
                .map_err(|_| Error::Invalid("AI の応答を読み取れませんでした".into()))
        } else {
            Ok(json!({ "text": text.trim() }))
        }
    });
    // The user may have closed the window to the tray while waiting.
    let body = match &value {
        Ok(_) => format!("「{label}」が終わりました。"),
        Err(e) => format!("「{label}」が失敗しました: {e}"),
    };
    tray::notify_if_hidden(&app, "ZWA CMS の AI", &body);
    value
}

/// Name of a task for notifications.
fn task_label(task: &Task, settings: &AiSettings) -> String {
    match task {
        Task::Proofread => "添削".into(),
        Task::Excerpt => "抜粋の作成".into(),
        Task::TitleSlug => "タイトル・スラッグの案".into(),
        Task::Terms => "カテゴリー・タグの提案".into(),
        Task::Article { .. } => "下書きの作成".into(),
        Task::Custom { prompt_id } => settings
            .prompts
            .iter()
            .find(|p| &p.id == prompt_id)
            .map_or_else(|| "独自のプロンプト".into(), |p| p.name.clone()),
    }
}

#[tauri::command]
pub fn ai_cancel(running: State<'_, Running>, request_id: String) {
    if let Some(h) = running.0.lock().unwrap().remove(&request_id) {
        h.abort();
    }
}

/// Adds a request's tokens to `ai_usage`. Failures are ignored: the AI result
/// matters more than the statistics. Cancelled requests are not recorded
/// (their usage never arrives).
async fn record_usage(app: &AppHandle, db: &Db, output: &anthropic::Output) {
    if migrations::ensure(app, db).await.is_err() {
        return;
    }
    let u = &output.usage;
    let _ = db
        .query(
            "INSERT INTO ai_usage (day, model, requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
             VALUES (date('now'), ?1, 1, ?2, ?3, ?4, ?5)
             ON CONFLICT (day, model) DO UPDATE SET
               requests = requests + 1,
               input_tokens = input_tokens + excluded.input_tokens,
               output_tokens = output_tokens + excluded.output_tokens,
               cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
               cache_write_tokens = cache_write_tokens + excluded.cache_write_tokens",
            &[
                json!(output.model),
                json!(u.input_tokens),
                json!(u.output_tokens),
                json!(u.cache_read_tokens),
                json!(u.cache_write_tokens),
            ],
        )
        .await;
}

#[derive(Serialize, Deserialize)]
pub struct UsageRow {
    /// YYYY-MM (UTC)
    month: String,
    model: String,
    requests: u64,
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
}

/// Monthly totals per model for the current site, newest first (12 months).
#[tauri::command]
pub async fn ai_usage(app: AppHandle) -> Result<Vec<UsageRow>> {
    let db = Db::open(&app)?;
    migrations::ensure(&app, &db).await?;
    db.rows(
        "SELECT substr(day, 1, 7) AS month, model,
                SUM(requests) AS requests,
                SUM(input_tokens) AS input_tokens,
                SUM(output_tokens) AS output_tokens,
                SUM(cache_read_tokens) AS cache_read_tokens,
                SUM(cache_write_tokens) AS cache_write_tokens
         FROM ai_usage
         WHERE day >= date('now', 'start of month', '-11 months')
         GROUP BY month, model
         ORDER BY month DESC, model",
        &[],
    )
    .await
}
