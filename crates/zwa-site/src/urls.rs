//! URL scheme of the generated site.
//!
//! - posts: `permalink.post` setting (default `/posts/{slug}/`)
//! - pages: `/<parent slugs>/<slug>/`
//! - categories / tags / authors: `/category/<slug>/`, `/tag/<slug>/`, `/author/<slug>/`
//! - home pagination `/page/<n>/`, search `/search/`, and the files in [`RESERVED`]
//!
//! URLs are kept decoded (slugs may be Japanese); use [`encode_path`] for
//! hrefs and [`file_for`] for output file names.

use percent_encoding::{AsciiSet, CONTROLS, utf8_percent_encode};

use crate::model::{AuthorData, PostData, TermData};
use crate::time::to_local;

/// Characters encoded within a path segment. Includes everything HTML
/// attributes need escaped, so encoded paths can be emitted as safe strings.
const SEGMENT: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'&')
    .add(b'\'')
    .add(b'%')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'`')
    .add(b'{')
    .add(b'}');

pub struct Urls<'a> {
    post_pattern: &'a str,
    offset: i64,
    pages: Vec<&'a PostData>,
}

impl<'a> Urls<'a> {
    pub fn new(post_pattern: &'a str, offset: i64, posts: &[&'a PostData]) -> Self {
        Self {
            post_pattern,
            offset,
            pages: posts.iter().copied().filter(|p| p.is_page()).collect(),
        }
    }

    pub fn post(&self, p: &PostData) -> String {
        if p.is_page() {
            let mut segs: Vec<&str> = self.ancestors(p).iter().map(|a| a.slug.as_str()).collect();
            segs.push(&p.slug);
            return format!("/{}/", segs.join("/"));
        }
        let t = p
            .published_at
            .as_deref()
            .and_then(|d| to_local(d, self.offset));
        let path = self
            .post_pattern
            .replace("{slug}", &p.slug)
            .replace("{id}", &p.id.to_string())
            .replace(
                "{year}",
                &t.map(|t| format!("{:04}", t.year)).unwrap_or_default(),
            )
            .replace(
                "{month}",
                &t.map(|t| format!("{:02}", t.month)).unwrap_or_default(),
            )
            .replace(
                "{day}",
                &t.map(|t| format!("{:02}", t.day)).unwrap_or_default(),
            );
        normalize(&path)
    }

    /// Ancestors of a page, root first. Stops on cycles or missing parents.
    pub fn ancestors(&self, p: &PostData) -> Vec<&'a PostData> {
        let mut out: Vec<&PostData> = Vec::new();
        let mut cur = p.parent_id;
        while let Some(id) = cur {
            let Some(parent) = self.pages.iter().find(|x| x.id == id) else {
                break;
            };
            if parent.id == p.id || out.iter().any(|a| a.id == parent.id) {
                break;
            }
            out.push(parent);
            cur = parent.parent_id;
        }
        out.reverse();
        out
    }

    pub fn category(&self, c: &TermData) -> String {
        format!("/category/{}/", c.slug)
    }

    pub fn tag(&self, t: &TermData) -> String {
        format!("/tag/{}/", t.slug)
    }

    pub fn author(&self, a: &AuthorData) -> String {
        format!("/author/{}/", a.slug)
    }
}

/// Top-level path segments the generator (or the published Worker) uses
/// itself. Top-level pages and posts can't take these slugs.
pub const RESERVED: &[&str] = &[
    "category",
    "tag",
    "author",
    "search",
    "page",
    "assets",
    "media",
    "pagefind",
    "_zwa",
    "404.html",
    "sitemap.xml",
    "feed.xml",
    "robots.txt",
    "favicon.ico",
];

/// Why `slug` can't be the first segment of a URL, if it can't.
/// `post_pattern` is the `permalink.post` setting: a literal first segment
/// (`posts` in `/posts/{slug}/`) belongs to posts, and date or ID
/// placeholders take the numbers.
pub fn root_conflict(slug: &str, post_pattern: &str) -> Option<String> {
    let lower = slug.to_ascii_lowercase();
    if RESERVED.contains(&lower.as_str()) {
        return Some(format!(
            "「{slug}」はサイトの仕組みで使うため、最上位のスラッグには使えません"
        ));
    }
    let first = post_pattern
        .split('/')
        .find(|s| !s.is_empty())
        .unwrap_or("");
    let numeric = !slug.is_empty() && slug.chars().all(|c| c.is_ascii_digit());
    let taken = match first {
        "{slug}" => false,
        "{year}" => numeric && slug.len() == 4,
        "{id}" => numeric,
        f if f.contains('{') => false,
        f => f.eq_ignore_ascii_case(slug),
    };
    taken.then(|| {
        format!(
            "「{slug}」は記事の URL（{post_pattern}）と重なるため、最上位のスラッグには使えません"
        )
    })
}

/// Collapses duplicate slashes (e.g. from empty placeholders) and ensures
/// leading and trailing slashes.
fn normalize(path: &str) -> String {
    let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if segs.is_empty() {
        "/".into()
    } else {
        format!("/{}/", segs.join("/"))
    }
}

pub fn encode_path(path: &str) -> String {
    path.split('/')
        .map(|seg| utf8_percent_encode(seg, SEGMENT).to_string())
        .collect::<Vec<_>>()
        .join("/")
}

/// `/posts/hello/` -> `posts/hello/index.html`.
pub fn file_for(url: &str) -> String {
    let trimmed = url.trim_matches('/');
    if trimmed.is_empty() {
        "index.html".into()
    } else {
        format!("{trimmed}/index.html")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn post(id: i64, kind: &str, slug: &str, parent: Option<i64>) -> PostData {
        PostData {
            id,
            kind: kind.into(),
            status: "published".into(),
            slug: slug.into(),
            title: slug.into(),
            body: String::new(),
            body_format: "markdown".into(),
            excerpt: None,
            parent_id: parent,
            sort_order: 0,
            published_at: Some("2026-10-25T16:00:00Z".into()),
            updated_at: "2026-10-25T16:00:00Z".into(),
            category_ids: vec![],
            tag_ids: vec![],
            image: None,
            image_alt: None,
            author_id: None,
            form_id: None,
        }
    }

    #[test]
    fn builds_urls() {
        let about = post(1, "page", "about", None);
        let team = post(2, "page", "team", Some(1));
        let hello = post(3, "post", "こんにちは", None);
        let all = [&about, &team, &hello];
        let urls = Urls::new("/{year}/{month}/{day}/{slug}/", 540, &all);
        assert_eq!(urls.post(&team), "/about/team/");
        // 16:00Z is the next day in +09:00.
        assert_eq!(urls.post(&hello), "/2026/10/26/こんにちは/");
        assert_eq!(
            encode_path("/2026/こんにちは/"),
            "/2026/%E3%81%93%E3%82%93%E3%81%AB%E3%81%A1%E3%81%AF/"
        );
        assert_eq!(file_for("/about/team/"), "about/team/index.html");
        assert_eq!(file_for("/"), "index.html");
    }

    #[test]
    fn detects_root_conflicts() {
        assert!(root_conflict("search", "/posts/{slug}/").is_some());
        assert!(root_conflict("Category", "/posts/{slug}/").is_some());
        assert!(root_conflict("posts", "/posts/{slug}/").is_some());
        assert!(root_conflict("posts", "/blog/{slug}/").is_none());
        assert!(root_conflict("2026", "/{year}/{month}/{slug}/").is_some());
        assert!(root_conflict("about", "/{year}/{month}/{slug}/").is_none());
        assert!(root_conflict("123", "/{id}/").is_some());
        assert!(root_conflict("contact", "/{slug}/").is_none());
    }
}
