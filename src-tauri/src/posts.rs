//! Posts and pages, stored in the site's D1 `posts` table.

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::AppHandle;

use crate::db::{Db, NOW, check_slug, unique_slug_error};
use crate::error::{Error, Result};

#[derive(Serialize, Deserialize)]
pub struct PostSummary {
    id: i64,
    title: String,
    slug: String,
    status: String,
    body_format: String,
    parent_id: Option<i64>,
    sort_order: i64,
    published_at: Option<String>,
    updated_at: String,
    /// For filtering the list.
    #[serde(deserialize_with = "json_ids")]
    category_ids: Vec<i64>,
    #[serde(deserialize_with = "json_ids")]
    tag_ids: Vec<i64>,
}

#[derive(Serialize, Deserialize)]
pub struct Post {
    id: i64,
    #[serde(rename = "type")]
    kind: String,
    status: String,
    slug: String,
    title: String,
    body: String,
    body_format: String,
    excerpt: Option<String>,
    parent_id: Option<i64>,
    sort_order: i64,
    published_at: Option<String>,
    updated_at: String,
    #[serde(deserialize_with = "json_ids")]
    category_ids: Vec<i64>,
    #[serde(deserialize_with = "json_ids")]
    tag_ids: Vec<i64>,
    featured_media_id: Option<i64>,
    author_id: Option<i64>,
    form_id: Option<i64>,
    /// Public path of the featured image (`/media/...`), for display.
    featured_image: Option<String>,
}

/// D1 returns `json_group_array(...)` as a JSON string.
fn json_ids<'de, D: serde::Deserializer<'de>>(d: D) -> std::result::Result<Vec<i64>, D::Error> {
    let s = String::deserialize(d)?;
    serde_json::from_str(&s).map_err(serde::de::Error::custom)
}

/// Editable fields sent from the editor. `id` is None for a new post;
/// `updated_at` is the value the editor loaded, used to detect edits made
/// elsewhere (e.g. on another PC) since then.
#[derive(Deserialize)]
pub struct PostInput {
    id: Option<i64>,
    updated_at: Option<String>,
    #[serde(rename = "type")]
    kind: String,
    status: String,
    slug: String,
    title: String,
    body: String,
    body_format: String,
    excerpt: Option<String>,
    parent_id: Option<i64>,
    sort_order: i64,
    published_at: Option<String>,
    #[serde(default)]
    category_ids: Vec<i64>,
    #[serde(default)]
    tag_ids: Vec<i64>,
    #[serde(default)]
    featured_media_id: Option<i64>,
    #[serde(default)]
    author_id: Option<i64>,
    #[serde(default)]
    form_id: Option<i64>,
}

fn validate(input: &PostInput) -> Result<()> {
    if !matches!(input.kind.as_str(), "post" | "page") {
        return Err(Error::Invalid("不正な種別です".into()));
    }
    if !matches!(input.status.as_str(), "draft" | "published") {
        return Err(Error::Invalid("不正な公開状態です".into()));
    }
    if !matches!(input.body_format.as_str(), "markdown" | "html") {
        return Err(Error::Invalid("不正な本文形式です".into()));
    }
    if input.title.trim().is_empty() {
        return Err(Error::Invalid("タイトルを入力してください".into()));
    }
    check_slug(&input.slug)?;
    if input.kind == "post" && input.parent_id.is_some() {
        return Err(Error::Invalid("記事には親ページを設定できません".into()));
    }
    if input.kind == "post" && input.form_id.is_some() {
        return Err(Error::Invalid(
            "フォームは固定ページにだけ設定できます".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn posts_list(app: AppHandle, kind: String) -> Result<Vec<PostSummary>> {
    let db = Db::open(&app)?;
    db.rows(
        "SELECT id, title, slug, status, body_format, parent_id, sort_order,
                published_at, updated_at,
                (SELECT json_group_array(category_id) FROM post_categories
                  WHERE post_id = posts.id) AS category_ids,
                (SELECT json_group_array(tag_id) FROM post_tags
                  WHERE post_id = posts.id) AS tag_ids
         FROM posts WHERE type = ?1
         ORDER BY CASE WHEN ?1 = 'page' THEN sort_order END, 
                  COALESCE(published_at, updated_at) DESC, id DESC",
        &[json!(kind)],
    )
    .await
}

#[tauri::command]
pub async fn post_get(app: AppHandle, id: i64) -> Result<Post> {
    let db = Db::open(&app)?;
    db.rows::<Post>(
        "SELECT id, type, status, slug, title, body, body_format, excerpt,
                parent_id, sort_order, published_at, updated_at,
                (SELECT json_group_array(category_id) FROM post_categories
                  WHERE post_id = posts.id) AS category_ids,
                (SELECT json_group_array(tag_id) FROM post_tags
                  WHERE post_id = posts.id) AS tag_ids,
                featured_media_id, author_id, form_id,
                (SELECT '/' || r2_key FROM media
                  WHERE id = posts.featured_media_id) AS featured_image
         FROM posts WHERE id = ?1",
        &[json!(id)],
    )
    .await?
    .pop()
    .ok_or_else(|| Error::Invalid("記事が見つかりません".into()))
}

#[tauri::command]
pub async fn post_save(app: AppHandle, input: PostInput) -> Result<Post> {
    validate(&input)?;
    let db = Db::open(&app)?;
    if let (Some(id), Some(parent)) = (input.id, input.parent_id) {
        check_parent(&db, id, parent).await?;
    }
    check_root(&db, &input).await?;
    // Publishing for the first time stamps the publish date.
    let published_at = match (&input.status[..], input.published_at.as_deref()) {
        ("published", None | Some("")) => None, // filled by SQL below
        (_, Some("")) => None,
        (_, p) => p.map(String::from),
    };
    let category_ids = input.category_ids.clone();
    let tag_ids = input.tag_ids.clone();
    let fields = [
        json!(input.kind),
        json!(input.status),
        json!(input.slug.trim()),
        json!(input.title.trim()),
        json!(input.body),
        json!(input.body_format),
        json!(input.excerpt.filter(|e| !e.trim().is_empty())),
        json!(input.parent_id),
        json!(input.sort_order),
        json!(published_at),
        json!(input.featured_media_id),
        json!(input.author_id),
        json!(input.form_id),
    ];
    let published_expr =
        format!("CASE WHEN ?2 = 'published' THEN COALESCE(?10, {NOW}) ELSE ?10 END");

    let id = match input.id {
        None => {
            let sql = format!(
                "INSERT INTO posts (type, status, slug, title, body, body_format, excerpt,
                                    parent_id, sort_order, published_at, featured_media_id,
                                    author_id, form_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, {published_expr}, ?11, ?12, ?13)
                 RETURNING id"
            );
            let row = db
                .query(&sql, &fields)
                .await
                .map_err(unique_slug_error)?
                .results
                .pop();
            row.and_then(|r| r.get("id")?.as_i64())
                .ok_or_else(|| Error::Cloudflare("作成した記事の ID が取得できません".into()))?
        }
        Some(id) => {
            let sql = format!(
                "UPDATE posts SET type = ?1, status = ?2, slug = ?3, title = ?4, body = ?5,
                    body_format = ?6, excerpt = ?7, parent_id = ?8, sort_order = ?9,
                    published_at = {published_expr}, featured_media_id = ?11, author_id = ?12,
                    form_id = ?13, updated_at = {NOW}
                 WHERE id = ?14 AND updated_at = ?15"
            );
            let mut params = fields.to_vec();
            params.push(json!(id));
            params.push(json!(input.updated_at));
            let result = db.query(&sql, &params).await.map_err(unique_slug_error)?;
            if result.meta.changes == 0 {
                return Err(Error::Invalid(
                    "この記事は他の場所で更新されたか削除されています。再読み込みしてから編集してください".into(),
                ));
            }
            id
        }
    };
    db.exec(&term_links_sql(id, &category_ids, &tag_ids))
        .await?;
    post_get(app, id).await
}

/// Top-level slugs can't shadow the site's own paths (`/search/`, the post
/// permalink prefix, ...). With posts at the top level too (`/{slug}/`), a
/// top-level page and a post can't share a slug either.
async fn check_root(db: &Db, input: &PostInput) -> Result<()> {
    #[derive(Deserialize)]
    struct Row {
        pattern: Option<String>,
        others: i64,
    }
    let slug = input.slug.trim();
    let row = db
        .rows::<Row>(
            "SELECT (SELECT value FROM settings WHERE key = ?1) AS pattern,
                    (SELECT COUNT(*) FROM posts
                      WHERE slug = ?2 AND type <> ?3
                        AND (type = 'post' OR parent_id IS NULL)) AS others",
            &[
                json!(zwa_site::keys::PERMALINK_POST),
                json!(slug),
                json!(input.kind),
            ],
        )
        .await?
        .pop();
    let pattern = row
        .as_ref()
        .and_then(|r| r.pattern.as_deref())
        .filter(|p| !p.trim().is_empty())
        .unwrap_or(zwa_site::keys::DEFAULT_PERMALINK_POST);
    let posts_at_root = pattern.split('/').find(|s| !s.is_empty()) == Some("{slug}");
    let at_root = if input.kind == "page" {
        input.parent_id.is_none()
    } else {
        posts_at_root
    };
    if !at_root {
        return Ok(());
    }
    if let Some(msg) = zwa_site::urls::root_conflict(slug, pattern) {
        return Err(Error::Invalid(msg));
    }
    if posts_at_root && row.is_some_and(|r| r.others > 0) {
        let other = if input.kind == "page" {
            "記事"
        } else {
            "最上位の固定ページ"
        };
        return Err(Error::Invalid(format!(
            "同じスラッグの{other}があり、URL が重なります。別のスラッグにしてください"
        )));
    }
    Ok(())
}

/// Walks up from the new parent; reaching the page itself means a cycle
/// (which would make its URL infinite).
async fn check_parent(db: &Db, id: i64, parent: i64) -> Result<()> {
    #[derive(Deserialize)]
    struct Link {
        id: i64,
        parent_id: Option<i64>,
    }
    let pages: Vec<Link> = db
        .rows("SELECT id, parent_id FROM posts WHERE type = 'page'", &[])
        .await?;
    let mut cur = Some(parent);
    // The step limit guards against cycles already in the data.
    for _ in 0..=pages.len() {
        let Some(p) = cur else { break };
        if p == id {
            return Err(Error::Invalid(
                "自分自身や子ページを親ページにはできません".into(),
            ));
        }
        cur = pages.iter().find(|l| l.id == p).and_then(|l| l.parent_id);
    }
    Ok(())
}

/// Replaces the post's category/tag links. IDs are integers, so inlining
/// them is safe and lets everything run as one batch.
fn term_links_sql(post_id: i64, category_ids: &[i64], tag_ids: &[i64]) -> String {
    let mut sql = format!(
        "DELETE FROM post_categories WHERE post_id = {post_id};
         DELETE FROM post_tags WHERE post_id = {post_id};"
    );
    for (table, column, ids) in [
        ("post_categories", "category_id", category_ids),
        ("post_tags", "tag_id", tag_ids),
    ] {
        if !ids.is_empty() {
            let values: Vec<String> = ids.iter().map(|id| format!("({post_id}, {id})")).collect();
            sql += &format!(
                "INSERT OR IGNORE INTO {table} (post_id, {column}) VALUES {};",
                values.join(", ")
            );
        }
    }
    sql
}

#[tauri::command]
pub async fn post_delete(app: AppHandle, id: i64) -> Result<()> {
    let db = Db::open(&app)?;
    db.query("DELETE FROM posts WHERE id = ?1", &[json!(id)])
        .await?;
    Ok(())
}
