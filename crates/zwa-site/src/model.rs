//! Input data for a build: a snapshot of the site's D1 database.
//!
//! Serializable so the same snapshot can be produced by the desktop app or
//! a CLI (e.g. in GitHub Actions).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct SiteData {
    /// Rows of the `settings` table.
    pub settings: BTreeMap<String, String>,
    pub posts: Vec<PostData>,
    pub categories: Vec<TermData>,
    pub tags: Vec<TermData>,
    pub redirects: Vec<Redirect>,
    #[serde(default)]
    pub authors: Vec<AuthorData>,
    #[serde(default)]
    pub forms: Vec<FormData>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PostData {
    pub id: i64,
    /// "post" or "page".
    #[serde(rename = "type")]
    pub kind: String,
    /// "draft" or "published".
    pub status: String,
    pub slug: String,
    pub title: String,
    pub body: String,
    /// "markdown" or "html".
    pub body_format: String,
    pub excerpt: Option<String>,
    pub parent_id: Option<i64>,
    pub sort_order: i64,
    pub published_at: Option<String>,
    pub updated_at: String,
    #[serde(default)]
    pub category_ids: Vec<i64>,
    #[serde(default)]
    pub tag_ids: Vec<i64>,
    /// Featured image path (`/media/...`) and its alt text.
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub image_alt: Option<String>,
    #[serde(default)]
    pub author_id: Option<i64>,
    /// Contact form shown under the body (pages only).
    #[serde(default)]
    pub form_id: Option<i64>,
}

impl PostData {
    pub fn is_page(&self) -> bool {
        self.kind == "page"
    }

    pub fn is_published(&self) -> bool {
        self.status == "published"
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TermData {
    pub id: i64,
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    /// Categories only.
    #[serde(default)]
    pub parent_id: Option<i64>,
    #[serde(default)]
    pub sort_order: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Redirect {
    pub from_path: String,
    pub to_path: String,
    pub status_code: u16,
}

/// A byline shown on the site (not a login account).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AuthorData {
    pub id: i64,
    pub slug: String,
    pub name: String,
    pub bio: Option<String>,
}

/// A contact form. Submissions go to the site's Worker (`/_zwa/forms/<id>`).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FormData {
    pub id: i64,
    pub name: String,
    pub fields: Vec<FormField>,
    pub submit_label: Option<String>,
    pub success_message: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FormField {
    /// Stable within the form; the input is named `f_<id>`.
    pub id: String,
    pub label: String,
    /// "text", "email", "tel", "textarea", "checkbox" (one box, e.g. an
    /// agreement), "select", "radio" or "checkboxes" (pick any of `options`).
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub required: bool,
    /// Choices for "select", "radio" and "checkboxes".
    #[serde(default)]
    pub options: Vec<String>,
}
