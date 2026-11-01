//! Contact forms: definitions, the Turnstile widget that guards them, and
//! the submissions the site's Worker stores in D1.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::AppHandle;
use zwa_core::turnstile;

use crate::db::{Db, NOW};
use crate::error::{Error, Result};

const FIELD_TYPES: &[&str] = &[
    "text",
    "email",
    "tel",
    "textarea",
    "checkbox",
    "select",
    "radio",
    "checkboxes",
];
/// Types that pick from `options`.
const CHOICE_TYPES: &[&str] = &["select", "radio", "checkboxes"];
const MAX_OPTIONS: usize = 50;
const MAX_FIELDS: usize = 30;

#[derive(Serialize)]
pub struct FormsStatus {
    enabled: bool,
}

#[tauri::command]
pub async fn forms_status(app: AppHandle) -> Result<FormsStatus> {
    let db = Db::open(&app)?;
    let sitekey = db.d1().setting(turnstile::SITEKEY).await?;
    Ok(FormsStatus {
        enabled: sitekey.is_some_and(|k| !k.is_empty()),
    })
}

/// `permission`: the token lacks the Turnstile permission; the screen shows
/// how to add it.
#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EnableResult {
    Enabled,
    Permission,
}

/// Creates the site's Turnstile widget (for its workers.dev and `site.url`
/// hostnames) and stores its site key, which turns forms on.
#[tauri::command]
pub async fn forms_enable(app: AppHandle) -> Result<EnableResult> {
    let db = Db::open(&app)?;
    let d1 = db.d1();
    if d1
        .setting(turnstile::SITEKEY)
        .await?
        .is_some_and(|k| !k.is_empty())
    {
        return Ok(EnableResult::Enabled);
    }
    let workers_dev =
        zwa_core::deploy::workers_dev_url(&db.client, &db.site.account_id, &db.site.worker_name)
            .await?;
    let site_url = d1
        .setting(zwa_site::keys::URL)
        .await?
        .filter(|u| !u.is_empty());
    let hosts = turnstile::hosts(&workers_dev, site_url.as_deref());
    let widget = match turnstile::create(
        &db.client,
        &db.site.account_id,
        &db.site.worker_name,
        &hosts,
    )
    .await
    {
        Ok(w) => w,
        Err(e) if turnstile::is_permission_error(&e) => return Ok(EnableResult::Permission),
        Err(e) => return Err(e.into()),
    };
    db.query(
        &format!(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = {NOW}"
        ),
        &[json!(turnstile::SITEKEY), json!(widget.sitekey)],
    )
    .await?;
    Ok(EnableResult::Enabled)
}

/// Turns forms off (from the next publish) and deletes the Turnstile
/// widget (an account has up to 20). Forms and submissions are kept.
/// Returns a warning when the widget couldn't be deleted; forms are off
/// either way.
#[tauri::command]
pub async fn forms_disable(app: AppHandle) -> Result<Option<String>> {
    let db = Db::open(&app)?;
    let sitekey = db.d1().setting(turnstile::SITEKEY).await?;
    db.query(
        "DELETE FROM settings WHERE key = ?1",
        &[json!(turnstile::SITEKEY)],
    )
    .await?;
    let Some(sitekey) = sitekey.filter(|k| !k.is_empty()) else {
        return Ok(None);
    };
    Ok(turnstile::delete(&db.client, &db.site.account_id, &sitekey)
        .await
        .err()
        .map(|e| {
            format!(
                "Turnstile のウィジェット（{sitekey}）を削除できませんでした。必要なら Cloudflare ダッシュボードの Turnstile から削除してください: {e}"
            )
        }))
}

#[derive(Serialize, Deserialize)]
pub struct Field {
    id: String,
    label: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    required: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    options: Vec<String>,
}

#[derive(Serialize)]
pub struct Form {
    id: i64,
    name: String,
    fields: Vec<Field>,
    submit_label: Option<String>,
    success_message: Option<String>,
    /// Pages that show the form (published or not).
    pages: Vec<FormPage>,
    submissions: i64,
    unread: i64,
}

#[derive(Serialize, Deserialize)]
pub struct FormPage {
    id: i64,
    title: String,
}

#[tauri::command]
pub async fn forms_list(app: AppHandle) -> Result<Vec<Form>> {
    #[derive(Deserialize)]
    struct Row {
        id: i64,
        name: String,
        fields: String,
        submit_label: Option<String>,
        success_message: Option<String>,
        pages: String,
        submissions: i64,
        unread: i64,
    }
    let rows: Vec<Row> = Db::open(&app)?
        .rows(
            "SELECT f.id, f.name, f.fields, f.submit_label, f.success_message,
                    (SELECT json_group_array(json_object('id', p.id, 'title', p.title))
                       FROM posts p WHERE p.form_id = f.id) AS pages,
                    (SELECT COUNT(*) FROM form_submissions s WHERE s.form_id = f.id) AS submissions,
                    (SELECT COUNT(*) FROM form_submissions s
                      WHERE s.form_id = f.id AND s.read_at IS NULL) AS unread
             FROM forms f ORDER BY f.id",
            &[],
        )
        .await?;
    rows.into_iter()
        .map(|r| {
            Ok(Form {
                id: r.id,
                name: r.name,
                fields: serde_json::from_str(&r.fields)?,
                submit_label: r.submit_label,
                success_message: r.success_message,
                pages: serde_json::from_str(&r.pages)?,
                submissions: r.submissions,
                unread: r.unread,
            })
        })
        .collect()
}

#[derive(Deserialize)]
pub struct FormInput {
    id: Option<i64>,
    name: String,
    fields: Vec<Field>,
    submit_label: Option<String>,
    success_message: Option<String>,
}

fn validate(input: &FormInput) -> Result<()> {
    if input.name.trim().is_empty() {
        return Err(Error::Invalid("フォームの名前を入力してください".into()));
    }
    if input.fields.is_empty() {
        return Err(Error::Invalid("項目を 1 つ以上追加してください".into()));
    }
    if input.fields.len() > MAX_FIELDS {
        return Err(Error::Invalid(format!("項目は {MAX_FIELDS} 個までです")));
    }
    for (i, f) in input.fields.iter().enumerate() {
        if f.label.trim().is_empty() {
            return Err(Error::Invalid(format!(
                "{} 番目の項目の名前を入力してください",
                i + 1
            )));
        }
        if f.label.chars().count() > 200 {
            return Err(Error::Invalid(format!("「{}」の名前が長すぎます", f.label)));
        }
        if !FIELD_TYPES.contains(&f.kind.as_str()) {
            return Err(Error::Invalid("不正な項目の種類です".into()));
        }
        if CHOICE_TYPES.contains(&f.kind.as_str()) {
            if f.options.is_empty() {
                return Err(Error::Invalid(format!(
                    "「{}」の選択肢を入力してください",
                    f.label
                )));
            }
            if f.options.len() > MAX_OPTIONS {
                return Err(Error::Invalid(format!(
                    "「{}」の選択肢は {MAX_OPTIONS} 個までです",
                    f.label
                )));
            }
            for (j, o) in f.options.iter().enumerate() {
                if o.trim().is_empty() || o.chars().count() > 100 {
                    return Err(Error::Invalid(format!(
                        "「{}」の選択肢は 1〜100 文字で入力してください",
                        f.label
                    )));
                }
                if f.options[..j].iter().any(|p| p.trim() == o.trim()) {
                    return Err(Error::Invalid(format!(
                        "「{}」の選択肢「{o}」が重複しています",
                        f.label
                    )));
                }
            }
        }
        if f.id.is_empty()
            || f.id.len() > 16
            || !f.id.chars().all(|c| c.is_ascii_alphanumeric())
            || input.fields[..i].iter().any(|g| g.id == f.id)
        {
            return Err(Error::Invalid("不正な項目 ID です".into()));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn form_save(app: AppHandle, input: FormInput) -> Result<i64> {
    validate(&input)?;
    let db = Db::open(&app)?;
    let trim = |s: &Option<String>| {
        s.as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
    };
    let fields: Vec<Field> = input
        .fields
        .into_iter()
        .map(|f| Field {
            label: f.label.trim().to_string(),
            // Only choice types keep options; each is trimmed.
            options: if CHOICE_TYPES.contains(&f.kind.as_str()) {
                f.options.iter().map(|o| o.trim().to_string()).collect()
            } else {
                Vec::new()
            },
            ..f
        })
        .collect();
    let mut params = vec![
        json!(input.name.trim()),
        json!(serde_json::to_string(&fields)?),
        json!(trim(&input.submit_label)),
        json!(trim(&input.success_message)),
    ];
    match input.id {
        None => {
            let row = db
                .query(
                    "INSERT INTO forms (name, fields, submit_label, success_message)
                     VALUES (?1, ?2, ?3, ?4) RETURNING id",
                    &params,
                )
                .await?
                .results
                .pop();
            row.and_then(|r| r.get("id")?.as_i64())
                .ok_or_else(|| Error::Cloudflare("作成したフォームの ID が取得できません".into()))
        }
        Some(id) => {
            params.push(json!(id));
            db.query(
                &format!(
                    "UPDATE forms SET name = ?1, fields = ?2, submit_label = ?3,
                        success_message = ?4, updated_at = {NOW}
                     WHERE id = ?5"
                ),
                &params,
            )
            .await?;
            Ok(id)
        }
    }
}

/// Also deletes its submissions; pages that showed it show none.
#[tauri::command]
pub async fn form_delete(app: AppHandle, id: i64) -> Result<()> {
    Db::open(&app)?
        .query("DELETE FROM forms WHERE id = ?1", &[json!(id)])
        .await?;
    Ok(())
}

#[derive(Serialize)]
pub struct Submission {
    id: i64,
    form_id: i64,
    /// `[{label, value}]` as submitted.
    data: Value,
    page_path: Option<String>,
    created_at: String,
    read_at: Option<String>,
}

/// Newest first, up to `limit`.
#[tauri::command]
pub async fn submissions_list(app: AppHandle, form_id: i64, limit: i64) -> Result<Vec<Submission>> {
    #[derive(Deserialize)]
    struct Row {
        id: i64,
        form_id: i64,
        data: String,
        page_path: Option<String>,
        created_at: String,
        read_at: Option<String>,
    }
    let rows: Vec<Row> = Db::open(&app)?
        .rows(
            "SELECT id, form_id, data, page_path, created_at, read_at FROM form_submissions
             WHERE form_id = ?1 ORDER BY id DESC LIMIT ?2",
            &[json!(form_id), json!(limit.clamp(1, 1000))],
        )
        .await?;
    rows.into_iter()
        .map(|r| {
            Ok(Submission {
                id: r.id,
                form_id: r.form_id,
                data: serde_json::from_str(&r.data).unwrap_or(Value::Null),
                page_path: r.page_path,
                created_at: r.created_at,
                read_at: r.read_at,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn submission_set_read(app: AppHandle, id: i64, read: bool) -> Result<()> {
    let sql = if read {
        format!("UPDATE form_submissions SET read_at = COALESCE(read_at, {NOW}) WHERE id = ?1")
    } else {
        "UPDATE form_submissions SET read_at = NULL WHERE id = ?1".to_string()
    };
    Db::open(&app)?.query(&sql, &[json!(id)]).await?;
    Ok(())
}

#[tauri::command]
pub async fn submission_delete(app: AppHandle, id: i64) -> Result<()> {
    Db::open(&app)?
        .query("DELETE FROM form_submissions WHERE id = ?1", &[json!(id)])
        .await?;
    Ok(())
}

#[derive(Serialize, Deserialize)]
pub struct Inbox {
    unread: i64,
    latest_id: Option<i64>,
}

/// Polled while the app runs. Notifies (when the window is hidden) about
/// submissions newer than `seen_id`, the `latest_id` of the previous poll.
#[tauri::command]
pub async fn submissions_poll(app: AppHandle, seen_id: Option<i64>) -> Result<Inbox> {
    let db = Db::open(&app)?;
    let inbox = db
        .rows::<Inbox>(
            "SELECT (SELECT COUNT(*) FROM form_submissions WHERE read_at IS NULL) AS unread,
                    (SELECT MAX(id) FROM form_submissions) AS latest_id",
            &[],
        )
        .await?
        .pop()
        .unwrap_or(Inbox {
            unread: 0,
            latest_id: None,
        });
    if let (Some(seen), Some(latest)) = (seen_id, inbox.latest_id)
        && latest > seen
    {
        crate::tray::notify_if_hidden(
            &app,
            &format!("{} の問い合わせ", db.site.title),
            &format!("新しい問い合わせがあります（未読 {} 件）", inbox.unread),
        );
    }
    Ok(inbox)
}
