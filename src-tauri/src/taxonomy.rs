//! Categories (hierarchical) and tags (flat). Authors are edited the same
//! way as tags (their `bio` is sent as `description`).

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::AppHandle;

use crate::db::{Db, NOW, check_slug, unique_slug_error};
use crate::error::{Error, Result};

#[derive(Serialize, Deserialize)]
pub struct Category {
    id: i64,
    slug: String,
    name: String,
    description: Option<String>,
    parent_id: Option<i64>,
    sort_order: i64,
    post_count: i64,
}

#[derive(Serialize, Deserialize)]
pub struct Tag {
    id: i64,
    slug: String,
    name: String,
    description: Option<String>,
    post_count: i64,
}

#[derive(Deserialize)]
pub struct TermInput {
    id: Option<i64>,
    slug: String,
    name: String,
    description: Option<String>,
    // Categories only.
    #[serde(default)]
    parent_id: Option<i64>,
    #[serde(default)]
    sort_order: i64,
}

fn check_name(name: &str) -> Result<()> {
    if name.trim().is_empty() {
        return Err(Error::Invalid("名前を入力してください".into()));
    }
    Ok(())
}

#[tauri::command]
pub async fn categories_list(app: AppHandle) -> Result<Vec<Category>> {
    Db::open(&app)?
        .rows(
            "SELECT c.id, c.slug, c.name, c.description, c.parent_id, c.sort_order,
                    (SELECT COUNT(*) FROM post_categories pc WHERE pc.category_id = c.id) AS post_count
             FROM categories c ORDER BY c.sort_order, c.name",
            &[],
        )
        .await
}

#[tauri::command]
pub async fn category_save(app: AppHandle, input: TermInput) -> Result<i64> {
    check_name(&input.name)?;
    check_slug(&input.slug)?;
    let db = Db::open(&app)?;

    if let (Some(id), Some(parent)) = (input.id, input.parent_id) {
        // Walk up from the new parent; reaching this category means a cycle.
        let parents: Vec<Category> = db
            .rows(
                "SELECT id, slug, name, description, parent_id, sort_order, 0 AS post_count
                 FROM categories",
                &[],
            )
            .await?;
        let mut cur = Some(parent);
        while let Some(c) = cur {
            if c == id {
                return Err(Error::Invalid(
                    "自分自身や子カテゴリーを親にはできません".into(),
                ));
            }
            cur = parents.iter().find(|p| p.id == c).and_then(|p| p.parent_id);
        }
    }

    let params = [
        json!(input.slug.trim()),
        json!(input.name.trim()),
        json!(input.description.filter(|d| !d.trim().is_empty())),
        json!(input.parent_id),
        json!(input.sort_order),
    ];
    match input.id {
        None => {
            let row = db
                .query(
                    "INSERT INTO categories (slug, name, description, parent_id, sort_order)
                     VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id",
                    &params,
                )
                .await
                .map_err(unique_slug_error)?
                .results
                .pop();
            row.and_then(|r| r.get("id")?.as_i64())
                .ok_or_else(|| Error::Cloudflare("作成したカテゴリーの ID が取得できません".into()))
        }
        Some(id) => {
            let mut params = params.to_vec();
            params.push(json!(id));
            db.query(
                &format!(
                    "UPDATE categories SET slug = ?1, name = ?2, description = ?3,
                       parent_id = ?4, sort_order = ?5, updated_at = {NOW}
                     WHERE id = ?6"
                ),
                &params,
            )
            .await
            .map_err(unique_slug_error)?;
            Ok(id)
        }
    }
}

/// Children move up to the deleted category's parent.
#[tauri::command]
pub async fn category_delete(app: AppHandle, id: i64) -> Result<()> {
    Db::open(&app)?
        .exec(&format!(
            "UPDATE categories SET parent_id = (SELECT parent_id FROM categories WHERE id = {id})
               WHERE parent_id = {id};
             DELETE FROM categories WHERE id = {id};"
        ))
        .await
}

#[tauri::command]
pub async fn tags_list(app: AppHandle) -> Result<Vec<Tag>> {
    Db::open(&app)?
        .rows(
            "SELECT t.id, t.slug, t.name, t.description,
                    (SELECT COUNT(*) FROM post_tags pt WHERE pt.tag_id = t.id) AS post_count
             FROM tags t ORDER BY t.name",
            &[],
        )
        .await
}

#[tauri::command]
pub async fn tag_save(app: AppHandle, input: TermInput) -> Result<i64> {
    check_name(&input.name)?;
    check_slug(&input.slug)?;
    let db = Db::open(&app)?;
    let params = [
        json!(input.slug.trim()),
        json!(input.name.trim()),
        json!(input.description.filter(|d| !d.trim().is_empty())),
    ];
    match input.id {
        None => {
            let row = db
                .query(
                    "INSERT INTO tags (slug, name, description) VALUES (?1, ?2, ?3) RETURNING id",
                    &params,
                )
                .await
                .map_err(unique_slug_error)?
                .results
                .pop();
            row.and_then(|r| r.get("id")?.as_i64())
                .ok_or_else(|| Error::Cloudflare("作成したタグの ID が取得できません".into()))
        }
        Some(id) => {
            let mut params = params.to_vec();
            params.push(json!(id));
            db.query(
                &format!(
                    "UPDATE tags SET slug = ?1, name = ?2, description = ?3, updated_at = {NOW}
                     WHERE id = ?4"
                ),
                &params,
            )
            .await
            .map_err(unique_slug_error)?;
            Ok(id)
        }
    }
}

#[tauri::command]
pub async fn tag_delete(app: AppHandle, id: i64) -> Result<()> {
    Db::open(&app)?
        .query("DELETE FROM tags WHERE id = ?1", &[json!(id)])
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn authors_list(app: AppHandle) -> Result<Vec<Tag>> {
    Db::open(&app)?
        .rows(
            "SELECT a.id, a.slug, a.name, a.bio AS description,
                    (SELECT COUNT(*) FROM posts p WHERE p.author_id = a.id) AS post_count
             FROM authors a ORDER BY a.name",
            &[],
        )
        .await
}

#[tauri::command]
pub async fn author_save(app: AppHandle, input: TermInput) -> Result<i64> {
    check_name(&input.name)?;
    check_slug(&input.slug)?;
    let db = Db::open(&app)?;
    let params = [
        json!(input.slug.trim()),
        json!(input.name.trim()),
        json!(input.description.filter(|d| !d.trim().is_empty())),
    ];
    match input.id {
        None => {
            let row = db
                .query(
                    "INSERT INTO authors (slug, name, bio) VALUES (?1, ?2, ?3) RETURNING id",
                    &params,
                )
                .await
                .map_err(unique_slug_error)?
                .results
                .pop();
            row.and_then(|r| r.get("id")?.as_i64())
                .ok_or_else(|| Error::Cloudflare("作成した著者の ID が取得できません".into()))
        }
        Some(id) => {
            let mut params = params.to_vec();
            params.push(json!(id));
            db.query(
                &format!(
                    "UPDATE authors SET slug = ?1, name = ?2, bio = ?3, updated_at = {NOW}
                     WHERE id = ?4"
                ),
                &params,
            )
            .await
            .map_err(unique_slug_error)?;
            Ok(id)
        }
    }
}

/// Posts keep existing; their author becomes unset (ON DELETE SET NULL).
#[tauri::command]
pub async fn author_delete(app: AppHandle, id: i64) -> Result<()> {
    Db::open(&app)?
        .query("DELETE FROM authors WHERE id = ?1", &[json!(id)])
        .await?;
    Ok(())
}
