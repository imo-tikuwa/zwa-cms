//! Static site generator for Zero Web Admin CMS.
//!
//! Takes a [`SiteData`] snapshot and produces the site's files in memory.
//! Media files referenced by the output (`/media/...`) are listed in
//! [`Output::media`]; fetching them from R2 is left to the caller.

mod highlight;
pub mod model;
mod render;
mod time;
pub mod urls;

use std::collections::{BTreeMap, BTreeSet};

use minijinja::value::Serde;
use minijinja::{Environment, Value, context};
use serde::Serialize;

pub use model::*;
use render::{body_html, excerpt_of};
use time::{LocalTime, parse_offset, to_local};
use urls::Urls;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("テンプレートの処理に失敗しました: {0}")]
    Template(#[from] minijinja::Error),
    #[error("検索インデックスの作成に失敗しました: {0}")]
    Search(String),
    #[error("{0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Debug, Default)]
pub struct BuildOptions {
    /// Include drafts (for local preview). Drafts are marked in the output.
    pub include_drafts: bool,
    /// Inject a script that reloads the page when a new build is served
    /// (polls `/__zwa/build`). Preview only.
    pub live_reload: bool,
    /// Custom theme files by relative path (e.g. `base.html`, `img/logo.png`).
    /// `.html` files and `style.css` override or extend the built-in
    /// templates; other files are copied to `/theme/<path>`.
    pub theme_files: BTreeMap<String, Vec<u8>>,
    /// Absolute site URL, overriding the `site.url` setting.
    pub base_url: Option<String>,
    /// Current time (`YYYY-MM-DDTHH:MM:SSZ`). Posts published after it are
    /// left out until a later build (scheduled posts). Defaults to the
    /// system clock.
    pub now: Option<String>,
}

#[derive(Debug, Default)]
pub struct Output {
    /// Output path (e.g. `posts/hello/index.html`) to file contents.
    pub files: BTreeMap<String, Vec<u8>>,
    /// R2 keys (e.g. `media/2026/10/a.jpg`) referenced by the output.
    pub media: BTreeSet<String>,
    pub warnings: Vec<String>,
}

/// Guide for theme authors, exported alongside the default theme.
pub const THEME_GUIDE: &str = include_str!("../THEME.md");

/// The built-in theme: template name and source.
pub const DEFAULT_THEME: &[(&str, &str)] = &[
    ("base.html", include_str!("../theme/base.html")),
    ("list.html", include_str!("../theme/list.html")),
    ("post.html", include_str!("../theme/post.html")),
    ("page.html", include_str!("../theme/page.html")),
    ("search.html", include_str!("../theme/search.html")),
    ("404.html", include_str!("../theme/404.html")),
    ("form.html", include_str!("../theme/form.html")),
    ("style.css", include_str!("../theme/style.css")),
];

/// Settings keys read by the generator, with defaults.
pub mod keys {
    pub const TITLE: &str = "site.title";
    pub const DESCRIPTION: &str = "site.description";
    pub const URL: &str = "site.url";
    pub const LANGUAGE: &str = "site.language";
    /// Fixed UTC offset used for dates and permalinks, e.g. `+09:00`.
    pub const UTC_OFFSET: &str = "site.utc_offset";
    pub const POSTS_PER_PAGE: &str = "site.posts_per_page";
    /// Images wider than this (px) are downscaled in the published site.
    pub const IMAGE_MAX_WIDTH: &str = "site.image_max_width";
    /// Placeholders: {slug} {id} {year} {month} {day}.
    pub const PERMALINK_POST: &str = "permalink.post";
    pub const DEFAULT_PERMALINK_POST: &str = "/posts/{slug}/";
    /// "off" disables site search (no Pagefind index, no /search/ page).
    pub const SEARCH: &str = "site.search";
    /// Design settings for the theme (all optional).
    pub const ACCENT_COLOR: &str = "theme.accent_color";
    /// Paths such as `/media/2026/10/logo.png`.
    pub const LOGO: &str = "theme.logo";
    pub const FAVICON: &str = "theme.favicon";
    pub const FOOTER_TEXT: &str = "theme.footer_text";
    pub const CUSTOM_CSS: &str = "theme.custom_css";
    /// "light" or "dark"; unset follows the visitor's OS.
    pub const COLOR_MODE: &str = "theme.color_mode";
    /// "-1" (darker), "0" or "1" (brighter).
    pub const BRIGHTNESS: &str = "theme.brightness";
    /// "on" shows a switch for visitors to choose light/dark and brightness;
    /// the two settings above are then where they start.
    pub const COLOR_SWITCH: &str = "theme.color_switch";
    /// Turnstile site key. Contact forms are shown only when it is set.
    pub const FORMS_SITEKEY: &str = "forms.turnstile_sitekey";
}

/// Turnstile's documented test key that always passes, for previews (the
/// real widget only works on the site's own hostnames).
const TURNSTILE_TEST_SITEKEY: &str = "1x00000000000000000000AA";

/// The browser side of contact forms, shipped when a page has one.
const FORM_JS: &str = include_str!("form.js");

#[derive(Serialize)]
struct Link {
    title: String,
    url: String,
}

#[derive(Serialize)]
struct Image {
    /// Path such as `/media/2026/10/a.jpg` (pass through the `url` filter).
    src: String,
    alt: String,
}

#[derive(Serialize)]
struct Author {
    name: String,
    url: String,
    bio: String,
}

#[derive(Serialize)]
struct FormView {
    action: String,
    sitekey: String,
    /// Submissions can't be sent from a preview.
    preview: bool,
    fields: Vec<FieldView>,
    submit_label: String,
    success_message: String,
}

#[derive(Serialize)]
struct FieldView {
    /// Input name (`f_<id>`).
    name: String,
    label: String,
    #[serde(rename = "type")]
    kind: String,
    required: bool,
    /// Longest accepted value (the Worker checks the same limits).
    max: usize,
    /// Choices for select / radio / checkboxes.
    options: Vec<String>,
}

/// Keep in step with `LIMITS` in zwa-core's worker.js.
fn field_max(kind: &str) -> usize {
    match kind {
        "email" => 254,
        "tel" => 30,
        "textarea" => 5000,
        "checkbox" => 10,
        _ => 200,
    }
}

#[derive(Serialize)]
struct PostCard {
    title: String,
    url: String,
    date: Option<String>,
    datetime: Option<String>,
    excerpt: String,
    draft: bool,
    categories: Vec<Link>,
    image: Option<Image>,
    author: Option<Author>,
}

struct Ctx<'a> {
    data: &'a SiteData,
    urls: Urls<'a>,
    offset: i64,
    base_url: Option<String>,
}

impl Ctx<'_> {
    fn local(&self, utc: Option<&str>) -> Option<LocalTime> {
        to_local(utc?, self.offset)
    }

    fn date(&self, utc: Option<&str>) -> Option<String> {
        self.local(utc).map(|t| t.format("%Y年%-m月%-d日"))
    }

    fn terms(
        &self,
        ids: &[i64],
        terms: &[TermData],
        url: impl Fn(&TermData) -> String,
    ) -> Vec<Link> {
        ids.iter()
            .filter_map(|id| terms.iter().find(|t| t.id == *id))
            .map(|t| Link {
                title: t.name.clone(),
                url: url(t),
            })
            .collect()
    }

    fn card(&self, p: &PostData) -> PostCard {
        PostCard {
            title: p.title.clone(),
            url: self.urls.post(p),
            date: self.date(p.published_at.as_deref()),
            datetime: self.local(p.published_at.as_deref()).map(|t| t.rfc3339()),
            excerpt: p
                .excerpt
                .clone()
                .filter(|e| !e.trim().is_empty())
                .unwrap_or_else(|| excerpt_of(&body_html(p), 120)),
            draft: !p.is_published(),
            categories: self.terms(&p.category_ids, &self.data.categories, |t| {
                self.urls.category(t)
            }),
            image: image(p),
            author: self.author(p),
        }
    }

    fn author(&self, p: &PostData) -> Option<Author> {
        let a = self
            .data
            .authors
            .iter()
            .find(|a| Some(a.id) == p.author_id)?;
        Some(Author {
            name: a.name.clone(),
            url: self.urls.author(a),
            bio: a.bio.clone().unwrap_or_default(),
        })
    }

    /// Absolute URL of the featured image, for `og:image`.
    fn og_image(&self, p: &PostData) -> Option<String> {
        self.absolute(&image(p)?.src)
    }

    fn absolute(&self, path: &str) -> Option<String> {
        self.base_url
            .as_ref()
            .map(|b| format!("{}{}", b.trim_end_matches('/'), path))
    }
}

pub async fn build(data: &SiteData, options: &BuildOptions) -> Result<Output> {
    let setting = |k: &str| {
        data.settings
            .get(k)
            .map(String::as_str)
            .filter(|v| !v.is_empty())
    };
    let offset = setting(keys::UTC_OFFSET)
        .and_then(parse_offset)
        .unwrap_or(540);
    let base_url = options
        .base_url
        .clone()
        .or_else(|| setting(keys::URL).map(String::from))
        .map(|u| u.trim_end_matches('/').to_string());
    let per_page = setting(keys::POSTS_PER_PAGE)
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|n| *n > 0)
        .unwrap_or(10);

    let search_enabled = setting(keys::SEARCH) != Some("off");
    let now = options.now.clone().unwrap_or_else(time::now_utc);
    let visible: Vec<&PostData> = data
        .posts
        .iter()
        .filter(|p| {
            options.include_drafts
                || (p.is_published() && p.published_at.as_deref().is_none_or(|t| t <= now.as_str()))
        })
        .collect();
    let urls = Urls::new(
        setting(keys::PERMALINK_POST).unwrap_or(keys::DEFAULT_PERMALINK_POST),
        offset,
        &visible,
    );
    let ctx = Ctx {
        data,
        urls,
        offset,
        base_url: base_url.clone(),
    };
    let mut out = Output::default();

    let form_sitekey = setting(keys::FORMS_SITEKEY).map(|k| {
        if options.live_reload {
            TURNSTILE_TEST_SITEKEY
        } else {
            k
        }
    });
    let form_view = |p: &PostData| -> Option<FormView> {
        let form = data.forms.iter().find(|f| Some(f.id) == p.form_id)?;
        Some(FormView {
            action: format!("/_zwa/forms/{}", form.id),
            sitekey: form_sitekey?.to_string(),
            preview: options.live_reload,
            fields: form
                .fields
                .iter()
                .map(|f| FieldView {
                    name: format!("f_{}", f.id),
                    label: f.label.clone(),
                    kind: f.kind.clone(),
                    required: f.required,
                    max: field_max(&f.kind),
                    options: f.options.clone(),
                })
                .collect(),
            submit_label: form
                .submit_label
                .clone()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| "送信する".into()),
            success_message: form
                .success_message
                .clone()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| "送信しました。お問い合わせありがとうございます。".into()),
        })
    };
    let mut has_form = false;

    // Posts newest first. Drafts without a date sort as "now".
    let mut posts: Vec<&PostData> = visible.iter().copied().filter(|p| !p.is_page()).collect();
    posts.sort_by(|a, b| {
        let key = |p: &PostData| p.published_at.clone().unwrap_or_else(|| "9999".into());
        key(b).cmp(&key(a)).then(b.id.cmp(&a.id))
    });
    let mut pages: Vec<&PostData> = visible.iter().copied().filter(|p| p.is_page()).collect();
    pages.sort_by(|a, b| a.sort_order.cmp(&b.sort_order).then(a.title.cmp(&b.title)));

    let mut env = environment(options)?;
    // Assets get a content-hashed copy under /assets/v/ that browsers may keep
    // for a year (see HEADERS). The plain paths stay for custom themes that
    // still link them directly.
    let css = env.get_template("style.css")?.render(context! {})?;
    let assets = BTreeMap::from([
        ("style.css".to_string(), css.into_bytes()),
        ("zwa-form.js".to_string(), FORM_JS.as_bytes().to_vec()),
    ]);
    let asset_urls: BTreeMap<String, String> = assets
        .iter()
        .map(|(name, bytes)| {
            (
                name.clone(),
                format!("/assets/v/{}/{name}", short_hash(bytes)),
            )
        })
        .collect();
    {
        let asset_urls = asset_urls.clone();
        env.add_function("asset", move |name: String| {
            match asset_urls.get(&name) {
                // Hex and our own file names: nothing to escape.
                Some(url) => Value::from_safe_string(url.clone()),
                None => Value::from(format!("/assets/{name}")),
            }
        });
    }
    let nav: Vec<Link> = pages
        .iter()
        .filter(|p| p.parent_id.is_none())
        .map(|p| Link {
            title: p.title.clone(),
            url: ctx.urls.post(p),
        })
        .collect();
    let category_links: Vec<Link> = data
        .categories
        .iter()
        .filter(|c| posts.iter().any(|p| p.category_ids.contains(&c.id)))
        .map(|c| Link {
            title: c.name.clone(),
            url: ctx.urls.category(c),
        })
        .collect();
    let site = context! {
        title => setting(keys::TITLE).unwrap_or("サイト名"),
        description => setting(keys::DESCRIPTION).unwrap_or(""),
        url => base_url,
        language => setting(keys::LANGUAGE).unwrap_or("ja"),
        nav => Serde(nav),
        categories => Serde(category_links),
        search => search_enabled,
        accent_color => setting(keys::ACCENT_COLOR).filter(|c| is_css_color(c)),
        color_mode => setting(keys::COLOR_MODE).filter(|m| matches!(*m, "light" | "dark")).unwrap_or("system"),
        brightness => setting(keys::BRIGHTNESS).filter(|b| matches!(*b, "-1" | "1")).unwrap_or("0"),
        color_switch => setting(keys::COLOR_SWITCH) == Some("on"),
        logo => setting(keys::LOGO),
        favicon => setting(keys::FAVICON),
        footer_text => setting(keys::FOOTER_TEXT),
        custom_css => setting(keys::CUSTOM_CSS).map(|c| Value::from_safe_string(c.replace("</", "<\\/"))),
    };
    let globals =
        context! { site, live_reload => options.live_reload, drafts => options.include_drafts };

    let render = |out: &mut Output, template: &str, path: &str, ctx_value: Value| -> Result<()> {
        let html = env
            .get_template(template)?
            .render(context! { ..ctx_value, ..globals.clone() })?;
        if out
            .files
            .insert(urls::file_for(path), html.into_bytes())
            .is_some()
        {
            out.warnings.push(format!(
                "{path} が複数のページで重なっています（後から生成したページだけが残ります）。スラッグを変更してください"
            ));
        }
        Ok(())
    };

    // Paginated listings: home, categories, tags.
    let listing = |out: &mut Output,
                   base: &str,
                   heading: Option<String>,
                   items: &[&PostData]|
     -> Result<()> {
        let total = items.len().div_ceil(per_page).max(1);
        for (i, chunk) in items
            .chunks(per_page)
            .chain(items.is_empty().then_some(&[][..]))
            .enumerate()
        {
            let n = i + 1;
            let page_url = |n: usize| {
                if n == 1 {
                    base.to_string()
                } else {
                    format!("{base}page/{n}/")
                }
            };
            render(
                out,
                "list.html",
                &page_url(n),
                context! {
                    heading => heading.clone(),
                    posts => Serde(chunk.iter().map(|p| ctx.card(p)).collect::<Vec<_>>()),
                    pagination => context! {
                        current => n,
                        total,
                        prev_url => (n > 1).then(|| page_url(n - 1)),
                        next_url => (n < total).then(|| page_url(n + 1)),
                    },
                },
            )?;
        }
        Ok(())
    };
    listing(&mut out, "/", None, &posts)?;
    for c in &data.categories {
        let items: Vec<&PostData> = posts
            .iter()
            .copied()
            .filter(|p| p.category_ids.contains(&c.id))
            .collect();
        if !items.is_empty() {
            listing(
                &mut out,
                &ctx.urls.category(c),
                Some(format!("カテゴリー: {}", c.name)),
                &items,
            )?;
        }
    }
    for t in &data.tags {
        let items: Vec<&PostData> = posts
            .iter()
            .copied()
            .filter(|p| p.tag_ids.contains(&t.id))
            .collect();
        if !items.is_empty() {
            listing(
                &mut out,
                &ctx.urls.tag(t),
                Some(format!("タグ: {}", t.name)),
                &items,
            )?;
        }
    }
    for a in &data.authors {
        let items: Vec<&PostData> = posts
            .iter()
            .copied()
            .filter(|p| p.author_id == Some(a.id))
            .collect();
        if !items.is_empty() {
            listing(
                &mut out,
                &ctx.urls.author(a),
                Some(format!("著者: {}", a.name)),
                &items,
            )?;
        }
    }

    // Single posts. `posts` is newest first, so "newer" is the previous item.
    let mut search_pages = Vec::new();
    for (i, p) in posts.iter().enumerate() {
        let url = ctx.urls.post(p);
        let link = |q: Option<&&PostData>| {
            q.map(|q| Link {
                title: q.title.clone(),
                url: ctx.urls.post(q),
            })
        };
        render(
            &mut out,
            "post.html",
            &url,
            context! {
                post => context! {
                    title => &p.title,
                    content => Value::from_safe_string(body_html(p)),
                    date => ctx.date(p.published_at.as_deref()),
                    datetime => ctx.local(p.published_at.as_deref()).map(|t| t.rfc3339()),
                    draft => !p.is_published(),
                    categories => Serde(ctx.terms(&p.category_ids, &data.categories, |t| ctx.urls.category(t))),
                    tags => Serde(ctx.terms(&p.tag_ids, &data.tags, |t| ctx.urls.tag(t))),
                    description => ctx.card(p).excerpt,
                    image => Serde(image(p)),
                    author => Serde(ctx.author(p)),
                },
                newer => Serde(link(i.checked_sub(1).and_then(|j| posts.get(j)))),
                older => Serde(link(posts.get(i + 1))),
                canonical => ctx.absolute(&url),
                og_image => ctx.og_image(p),
            },
        )?;
        search_pages.push(url);
    }

    // Pages, with breadcrumbs and children.
    for p in &pages {
        let url = ctx.urls.post(p);
        let breadcrumbs: Vec<Link> = ctx
            .urls
            .ancestors(p)
            .into_iter()
            .map(|a| Link {
                title: a.title.clone(),
                url: ctx.urls.post(a),
            })
            .collect();
        let children: Vec<Link> = pages
            .iter()
            .filter(|c| c.parent_id == Some(p.id))
            .map(|c| Link {
                title: c.title.clone(),
                url: ctx.urls.post(c),
            })
            .collect();
        let form = form_view(p);
        has_form |= form.is_some();
        render(
            &mut out,
            "page.html",
            &url,
            context! {
                form => Serde(form),
                page => context! {
                    title => &p.title,
                    content => Value::from_safe_string(body_html(p)),
                    draft => !p.is_published(),
                    description => ctx.card(p).excerpt,
                    image => Serde(image(p)),
                },
                breadcrumbs => Serde(breadcrumbs),
                children => Serde(children),
                canonical => ctx.absolute(&url),
                og_image => ctx.og_image(p),
            },
        )?;
        search_pages.push(url);
    }

    if search_enabled {
        render(&mut out, "search.html", "/search/", context! {})?;
    }
    let not_found = env.get_template("404.html")?.render(globals.clone())?;
    out.files.insert("404.html".into(), not_found.into_bytes());
    for (name, bytes) in assets {
        if name == "zwa-form.js" && !has_form {
            continue;
        }
        out.files.insert(
            asset_urls[&name].trim_start_matches('/').to_string(),
            bytes.clone(),
        );
        out.files.insert(format!("assets/{name}"), bytes);
    }

    // Feeds and crawler files need absolute URLs.
    match &ctx.base_url {
        Some(_) => {
            out.files.insert(
                "sitemap.xml".into(),
                sitemap(&ctx, &posts, &pages).into_bytes(),
            );
            out.files.insert(
                "feed.xml".into(),
                feed(
                    &ctx,
                    &posts,
                    setting(keys::TITLE).unwrap_or(""),
                    setting(keys::DESCRIPTION).unwrap_or(""),
                )
                .into_bytes(),
            );
            out.files.insert(
                "robots.txt".into(),
                format!(
                    "User-agent: *\nAllow: /\nSitemap: {}\n",
                    ctx.absolute("/sitemap.xml").unwrap()
                )
                .into_bytes(),
            );
        }
        // Previews never need them; publishing passes the workers.dev URL.
        None if options.live_reload => {}
        None => out
            .warnings
            .push("サイトの URL が未設定のため、sitemap.xml と feed.xml は出力していません".into()),
    }

    out.files
        .insert("_headers".into(), HEADERS.as_bytes().to_vec());
    if !data.redirects.is_empty() {
        let lines: String = data
            .redirects
            .iter()
            .map(|r| format!("{} {} {}\n", r.from_path, r.to_path, r.status_code))
            .collect();
        out.files.insert("_redirects".into(), lines.into_bytes());
    }

    for (name, bytes) in &options.theme_files {
        if !is_template(name) {
            out.files.insert(format!("theme/{name}"), bytes.clone());
        }
    }

    collect_media(&mut out);
    if search_enabled {
        index_search(&mut out, &search_pages).await?;
    }
    Ok(out)
}

/// Security headers applied to every response (Workers Static Assets
/// `_headers` file). Kept conservative so typical embeds keep working.
/// Hashed assets are cached for good; media for a day, since a deleted file's
/// key can be reused and resizing can change a file under the same name.
/// Everything else (HTML, plain asset paths, Pagefind) keeps the platform
/// default of revalidating on every load. No `public`: shared caches then
/// skip responses to requests with Basic authentication (RFC 9111 3.5).
const HEADERS: &str = "/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()

/assets/v/*
  Cache-Control: max-age=31536000, immutable

/media/*
  Cache-Control: max-age=86400
";

/// First 10 hex digits of the SHA-256, for cache-busting asset paths.
fn short_hash(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes)[..5]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Theme files rendered as templates; everything else is a static asset.
fn is_template(name: &str) -> bool {
    name.ends_with(".html") || name == "style.css"
}

/// Checks that custom theme files parse, so a broken theme is caught
/// before it is uploaded.
pub fn check_theme(theme_files: &BTreeMap<String, Vec<u8>>) -> Result<()> {
    environment(&BuildOptions {
        theme_files: theme_files.clone(),
        ..Default::default()
    })
    .map(|_| ())
}

fn environment(options: &BuildOptions) -> Result<Environment<'static>> {
    let mut env = Environment::new();
    for (name, source) in DEFAULT_THEME {
        if !options.theme_files.contains_key(*name) {
            env.add_template_owned(*name, source.to_string())?;
        }
    }
    for (name, bytes) in &options.theme_files {
        if is_template(name) {
            env.add_template_owned(name.clone(), String::from_utf8_lossy(bytes).into_owned())?;
        }
    }
    // Encodes a URL path for use in href (slugs may contain non-ASCII). The
    // result needs no further HTML escaping.
    env.add_filter("url", |path: String| {
        Value::from_safe_string(urls::encode_path(&path))
    });
    Ok(env)
}

fn image(p: &PostData) -> Option<Image> {
    p.image.as_ref().filter(|s| !s.is_empty()).map(|src| Image {
        src: src.clone(),
        alt: p.image_alt.clone().unwrap_or_default(),
    })
}

fn collect_media(out: &mut Output) {
    let re = regex::Regex::new(r#"/(media/[^\s"'()<>,]+)"#).unwrap();
    for (name, bytes) in &out.files {
        if !name.ends_with(".html") {
            continue;
        }
        let html = String::from_utf8_lossy(bytes);
        for m in re.captures_iter(&html) {
            let key = percent_encoding::percent_decode_str(&m[1]).decode_utf8_lossy();
            // Drop query strings/fragments and HTML entities that may follow.
            let key = key.split(['?', '#', '&']).next().unwrap_or_default();
            out.media.insert(key.to_string());
        }
    }
}

async fn index_search(out: &mut Output, pages: &[String]) -> Result<()> {
    let err = |e: anyhow_like::E| Error::Search(e.0);
    let mut index = pagefind::api::PagefindIndex::new(None).map_err(|e| err(e.into()))?;
    for url in pages {
        let Some(html) = out.files.get(&urls::file_for(url)) else {
            continue;
        };
        index
            .add_html_file(
                None,
                Some(urls::encode_path(url)),
                String::from_utf8_lossy(html).into_owned(),
            )
            .await
            .map_err(|e| err(e.into()))?;
    }
    index.build_indexes().await.map_err(|e| err(e.into()))?;
    for file in index.get_files().await.map_err(|e| err(e.into()))? {
        let path = file.filename.to_string_lossy().replace('\\', "/");
        out.files.insert(format!("pagefind/{path}"), file.contents);
    }
    Ok(())
}

/// pagefind returns `anyhow::Error`; avoid depending on anyhow directly.
mod anyhow_like {
    pub struct E(pub String);
    impl<T: std::fmt::Display> From<T> for E {
        fn from(e: T) -> Self {
            E(e.to_string())
        }
    }
}

/// Only `#rgb` / `#rrggbb`, so the value is safe inside a <style> block.
fn is_css_color(c: &str) -> bool {
    let hex = c.strip_prefix('#').unwrap_or("");
    matches!(hex.len(), 3 | 6) && hex.chars().all(|ch| ch.is_ascii_hexdigit())
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn sitemap(ctx: &Ctx, posts: &[&PostData], pages: &[&PostData]) -> String {
    let mut xml = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n",
    );
    let mut add = |path: &str, updated: Option<&str>| {
        xml += &format!(
            "  <url><loc>{}</loc>",
            xml_escape(&ctx.absolute(&urls::encode_path(path)).unwrap())
        );
        if let Some(t) = ctx.local(updated) {
            xml += &format!("<lastmod>{}</lastmod>", t.rfc3339());
        }
        xml += "</url>\n";
    };
    // The home page lists posts, so it changes whenever any of them does.
    add("/", posts.iter().map(|p| p.updated_at.as_str()).max());
    for p in posts.iter().chain(pages).filter(|p| p.is_published()) {
        add(&ctx.urls.post(p), Some(&p.updated_at));
    }
    xml + "</urlset>\n"
}

fn feed(ctx: &Ctx, posts: &[&PostData], title: &str, description: &str) -> String {
    let home = ctx.absolute("/").unwrap();
    let mut xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<rss version=\"2.0\">\n<channel>\n  <title>{}</title>\n  <link>{}</link>\n  <description>{}</description>\n",
        xml_escape(title),
        xml_escape(&home),
        xml_escape(description)
    );
    for p in posts.iter().filter(|p| p.is_published()).take(20) {
        let link = ctx.absolute(&urls::encode_path(&ctx.urls.post(p))).unwrap();
        xml += &format!(
            "  <item>\n    <title>{}</title>\n    <link>{link}</link>\n    <guid>{link}</guid>\n",
            xml_escape(&p.title)
        );
        if let Some(t) = ctx.local(p.published_at.as_deref()) {
            xml += &format!("    <pubDate>{}</pubDate>\n", t.rfc2822());
        }
        xml += &format!(
            "    <description>{}</description>\n  </item>\n",
            xml_escape(&ctx.card(p).excerpt)
        );
    }
    xml + "</channel>\n</rss>\n"
}
