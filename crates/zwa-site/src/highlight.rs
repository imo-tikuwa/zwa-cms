//! Syntax highlighting for fenced code blocks.
//!
//! Tokens get highlight.js class names (`hljs-keyword`, `hljs-string`, ...)
//! instead of syntect's scope names, so one small stylesheet colors both the
//! published site and the app's visual editor (which uses lowlight, i.e.
//! highlight.js grammars). Colors are left to the theme.

use std::borrow::Cow;
use std::collections::HashMap;
use std::fmt::{self, Write};
use std::sync::LazyLock;

use comrak::adapters::SyntaxHighlighterAdapter;
use comrak::html::{escape, write_opening_tag};
use syntect::parsing::{ParseState, Scope, ScopeStack, SyntaxReference, SyntaxSet};
use syntect::util::LinesWithEndings;

static SYNTAXES: LazyLock<SyntaxSet> = LazyLock::new(two_face::syntax::extra_newlines);

/// Scope prefix → class, checked from the innermost scope outward; the
/// first scope that matches decides. `None` stops without a class (so `=`
/// isn't colored like a keyword).
static RULES: LazyLock<Vec<(Scope, Option<&'static str>)>> = LazyLock::new(|| {
    [
        ("comment", Some("hljs-comment")),
        ("string", Some("hljs-string")),
        ("constant.character.escape", Some("hljs-string")),
        ("constant.numeric", Some("hljs-number")),
        ("constant.language", Some("hljs-literal")),
        ("keyword.operator", None),
        ("keyword", Some("hljs-keyword")),
        ("storage", Some("hljs-keyword")),
        ("entity.name.function", Some("hljs-title")),
        ("support.function", Some("hljs-built_in")),
        ("variable.function", Some("hljs-title")),
        ("support.type.property-name", Some("hljs-attr")),
        ("entity.name.tag", Some("hljs-name")),
        ("entity.other.attribute-name", Some("hljs-attr")),
        ("meta.mapping.key", Some("hljs-attr")),
        ("entity.name", Some("hljs-type")),
        ("support.type", Some("hljs-type")),
        ("support.class", Some("hljs-type")),
        ("variable.language", Some("hljs-built_in")),
        ("support.constant", Some("hljs-built_in")),
        ("variable.parameter", Some("hljs-params")),
        ("meta.preprocessor", Some("hljs-meta")),
        ("markup.heading", Some("hljs-section")),
        ("markup.inserted", Some("hljs-addition")),
        ("markup.deleted", Some("hljs-deletion")),
    ]
    .into_iter()
    .map(|(s, c)| (Scope::new(s).expect("valid scope"), c))
    .collect()
});

/// Names that people write after ``` but syntect doesn't know as a token.
fn token_for(lang: &str) -> Cow<'_, str> {
    let lower = lang.to_ascii_lowercase();
    let alias = match lower.as_str() {
        "shell" | "console" | "zsh" | "sh" => "bash",
        "c++" => "cpp",
        "c#" | "csharp" => "cs",
        "golang" => "go",
        "docker" => "dockerfile",
        "jsonc" => "json",
        "powershell" | "pwsh" => "ps1",
        "javascript" | "mjs" | "cjs" => "js",
        "typescript" => "ts",
        "kotlin" => "kt",
        "markdown" => "md",
        "yml" => "yaml",
        "svg" => "xml",
        _ => return Cow::Owned(lower),
    };
    Cow::Borrowed(alias)
}

/// The syntax for a fence's info string (`rust`, `ts`, `rust,ignore`), if known.
pub fn syntax_for(lang: &str) -> Option<&'static SyntaxReference> {
    let name = lang.split([',', ' ']).next().unwrap_or("").trim();
    if name.is_empty() {
        return None;
    }
    SYNTAXES.find_syntax_by_token(&token_for(name))
}

fn class_of(stack: &ScopeStack) -> Option<&'static str> {
    for scope in stack.as_slice().iter().rev() {
        if let Some((_, class)) = RULES.iter().find(|(prefix, _)| prefix.is_prefix_of(*scope)) {
            return *class;
        }
    }
    None
}

/// Accumulates text, merging adjacent tokens with the same class into one span.
#[derive(Default)]
struct Spans {
    out: String,
    class: Option<&'static str>,
    buf: String,
}

impl Spans {
    fn push(&mut self, text: &str, class: Option<&'static str>) {
        if text.is_empty() {
            return;
        }
        if class != self.class {
            self.flush();
            self.class = class;
        }
        self.buf.push_str(text);
    }

    fn flush(&mut self) {
        if self.buf.is_empty() {
            return;
        }
        // Writing to a String can't fail.
        if let Some(c) = self.class {
            let _ = write!(self.out, "<span class=\"{c}\">");
            let _ = escape(&mut self.out, &self.buf);
            self.out.push_str("</span>");
        } else {
            let _ = escape(&mut self.out, &self.buf);
        }
        self.buf.clear();
    }
}

/// Highlighted HTML for `code` (without the `<pre><code>` wrapper).
pub fn highlight(code: &str, syntax: &SyntaxReference) -> Result<String, syntect::Error> {
    let mut spans = Spans::default();
    let mut state = ParseState::new(syntax);
    let mut stack = ScopeStack::new();
    for line in LinesWithEndings::from(code) {
        let mut pos = 0;
        for (i, op) in state.parse_line(line, &SYNTAXES)? {
            spans.push(&line[pos..i], class_of(&stack));
            stack.apply(&op)?;
            pos = i;
        }
        spans.push(&line[pos..], class_of(&stack));
    }
    spans.flush();
    Ok(spans.out)
}

/// comrak adapter. Unknown or missing languages are written as plain text.
pub struct Highlighter;

impl SyntaxHighlighterAdapter for Highlighter {
    fn write_highlighted(&self, output: &mut dyn fmt::Write, lang: Option<&str>, code: &str) -> fmt::Result {
        match lang.and_then(syntax_for).map(|s| highlight(code, s)) {
            Some(Ok(html)) => output.write_str(&html),
            _ => escape(output, code),
        }
    }

    fn write_pre_tag(&self, output: &mut dyn fmt::Write, attributes: HashMap<&'static str, Cow<'_, str>>) -> fmt::Result {
        write_opening_tag(output, "pre", attributes)
    }

    fn write_code_tag(&self, output: &mut dyn fmt::Write, attributes: HashMap<&'static str, Cow<'_, str>>) -> fmt::Result {
        write_opening_tag(output, "code", attributes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The names listed in README.md / README_ja.md (syntax highlighting) and accepted by the editor
    /// (src/lib/codeLanguages.ts).
    pub const DOCUMENTED: &[&str] = &[
        "bash", "sh", "shell", "zsh", "console", "c", "cpp", "c++", "csharp", "cs", "css", "scss", "diff",
        "dockerfile", "docker", "go", "golang", "html", "xml", "svg", "ini", "toml", "java", "kotlin", "kt",
        "javascript", "js", "jsx", "typescript", "ts", "tsx", "json", "jsonc", "lua", "markdown", "md", "php",
        "powershell", "ps1", "pwsh", "python", "py", "ruby", "rb", "rust", "rs", "sql", "swift", "yaml", "yml",
    ];

    #[test]
    fn documented_languages_are_known() {
        let missing: Vec<_> = DOCUMENTED.iter().filter(|l| syntax_for(l).is_none()).collect();
        assert!(missing.is_empty(), "no syntax for {missing:?}");
    }

    #[test]
    fn highlights_with_hljs_classes() {
        let html = highlight("fn main() { let s = \"a<b\"; } // hi\n", syntax_for("rust").unwrap()).unwrap();
        assert!(html.contains(r#"<span class="hljs-keyword">fn</span>"#), "{html}");
        assert!(html.contains(r#"<span class="hljs-string">&quot;a&lt;b&quot;</span>"#), "{html}");
        assert!(html.contains(r#"<span class="hljs-comment">// hi"#), "{html}");
    }

    #[test]
    fn unknown_language_is_plain() {
        assert!(syntax_for("nosuchlang").is_none());
        assert!(syntax_for("").is_none());
        assert_eq!(syntax_for("rust,ignore").unwrap().name, "Rust");
    }
}
