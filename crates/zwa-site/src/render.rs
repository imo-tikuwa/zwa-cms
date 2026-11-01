//! Post body rendering.

use comrak::options::Plugins;
use comrak::{Options, markdown_to_html_with_plugins};

use crate::model::PostData;

pub fn body_html(p: &PostData) -> String {
    let html = match p.body_format.as_str() {
        // Imported WordPress content is kept as-is.
        "html" => p.body.clone(),
        _ => markdown(&p.body),
    };
    lazy_images(&html)
}

/// Adds `loading="lazy" decoding="async"` to images that don't set loading.
pub fn lazy_images(html: &str) -> String {
    let re = regex::Regex::new(r"(?i)<img\b[^>]*>").unwrap();
    re.replace_all(html, |caps: &regex::Captures| {
        let tag = &caps[0];
        if tag.to_ascii_lowercase().contains("loading=") {
            tag.to_string()
        } else {
            format!(r#"<img loading="lazy" decoding="async"{}"#, &tag[4..])
        }
    })
    .into_owned()
}

pub fn markdown(md: &str) -> String {
    let mut options = Options::default();
    let ext = &mut options.extension;
    ext.strikethrough = true;
    ext.table = true;
    ext.autolink = true;
    ext.tasklist = true;
    ext.footnotes = true;
    // The site owner writes the content, so raw HTML in Markdown is allowed.
    options.render.r#unsafe = true;
    let mut plugins = Plugins::default();
    plugins.render.codefence_syntax_highlighter = Some(&crate::highlight::Highlighter);
    markdown_to_html_with_plugins(md, &options, &plugins)
}

/// Plain-text summary of rendered HTML, cut to `max` characters.
pub fn excerpt_of(html: &str, max: usize) -> String {
    // Paragraphs read as a summary; headings and list items joined into
    // one line look broken. Fall back to all text if there are none.
    let paragraphs = paragraphs_of(html);
    let source = if paragraphs.trim().is_empty() {
        html
    } else {
        &paragraphs
    };
    plain_excerpt(source, max)
}

/// The inner HTML of the top-level-ish `<p>` elements, space separated.
fn paragraphs_of(html: &str) -> String {
    let mut out = String::new();
    let mut rest = html;
    while let Some(start) = rest.find("<p") {
        let after = &rest[start + 2..];
        // `<p>` or `<p ...>`, not `<pre>` etc.
        if !after.starts_with('>') && !after.starts_with(' ') {
            rest = after;
            continue;
        }
        let Some(open_end) = after.find('>') else {
            break;
        };
        let body = &after[open_end + 1..];
        let Some(close) = body.find("</p>") else {
            break;
        };
        out.push_str(&body[..close]);
        out.push(' ');
        rest = &body[close + 4..];
    }
    out
}

fn plain_excerpt(html: &str, max: usize) -> String {
    // Block tags separate words; inline ones (<strong>, <a>, ...) don't,
    // which matters for Japanese text without spaces.
    const BLOCKS: &[&str] = &[
        "p",
        "br",
        "li",
        "ul",
        "ol",
        "div",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "blockquote",
        "pre",
        "tr",
        "td",
        "th",
        "hr",
        "figure",
        "figcaption",
        "img",
    ];
    let mut text = String::new();
    let mut tag: Option<String> = None;
    for c in html.chars() {
        match (&mut tag, c) {
            (None, '<') => tag = Some(String::new()),
            (Some(name), '>') => {
                let name = name.trim_start_matches('/');
                let name = name
                    .split(|c: char| c.is_whitespace() || c == '/')
                    .next()
                    .unwrap_or("");
                if BLOCKS.contains(&name.to_ascii_lowercase().as_str()) {
                    text.push(' ');
                }
                tag = None;
            }
            (Some(name), c) => name.push(c),
            (None, c) => text.push(c),
        }
    }
    let text = decode_entities(&text);
    let words: Vec<&str> = text.split_whitespace().collect();
    let text = words.join(" ");
    if text.chars().count() <= max {
        text
    } else {
        text.chars().take(max).collect::<String>() + "…"
    }
}

fn decode_entities(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
}

#[cfg(test)]
mod tests {

    #[test]
    fn excerpts_prefer_paragraphs() {
        let html = "<h2>見出し</h2><ul><li>1111</li><li>2222</li></ul><p>本文の<strong>最初</strong>の段落。</p><pre><code>x</code></pre><p>次。</p>";
        assert_eq!(excerpt_of(html, 120), "本文の最初の段落。 次。");
        // No paragraphs: all text.
        assert_eq!(excerpt_of("<ul><li>a</li><li>b</li></ul>", 120), "a b");
    }
    use super::*;

    #[test]
    fn renders_markdown() {
        let html = markdown("# Hi\n\n- [x] done\n\n~~old~~ <span>raw</span>");
        assert!(html.contains("<h1>Hi</h1>"));
        assert!(html.contains("checked"));
        assert!(html.contains("<del>old</del>"));
        assert!(html.contains("<span>raw</span>"));
    }

    #[test]
    fn lazy_loads_images() {
        assert_eq!(
            lazy_images(r#"<p><img src="/a.jpg" alt="x"><IMG loading="eager" src="/b.jpg"></p>"#),
            r#"<p><img loading="lazy" decoding="async" src="/a.jpg" alt="x"><IMG loading="eager" src="/b.jpg"></p>"#
        );
    }

    #[test]
    fn makes_excerpts() {
        assert_eq!(
            excerpt_of("<p>Hello &amp; <b>world</b></p>", 50),
            "Hello & world"
        );
        assert_eq!(excerpt_of("<p>あいうえお</p>", 3), "あいう…");
    }
}
