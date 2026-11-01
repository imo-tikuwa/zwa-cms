use zwa_site::{BuildOptions, FormData, FormField, PostData, Redirect, SiteData, TermData, build};

fn post(id: i64, kind: &str, status: &str, slug: &str, body: &str) -> PostData {
    PostData {
        id,
        kind: kind.into(),
        status: status.into(),
        slug: slug.into(),
        title: format!("タイトル{id}"),
        body: body.into(),
        body_format: "markdown".into(),
        excerpt: None,
        parent_id: None,
        sort_order: 0,
        published_at: (status == "published").then(|| format!("2026-10-{:02}T00:00:00Z", id)),
        updated_at: "2026-10-26T00:00:00Z".into(),
        category_ids: vec![],
        tag_ids: vec![],
        image: None,
        image_alt: None,
        author_id: None,
        form_id: None,
    }
}

fn sample() -> SiteData {
    let mut hello = post(
        1,
        "post",
        "published",
        "hello",
        "本文です。\n\n![写真](/media/2026/10/a%20b.jpg)",
    );
    hello.category_ids = vec![10];
    hello.tag_ids = vec![20];
    let mut data = SiteData {
        posts: vec![
            hello,
            post(2, "post", "published", "日本語", "**second**"),
            post(3, "post", "draft", "draft", "draft body"),
            post(4, "page", "published", "about", "about page"),
        ],
        categories: vec![TermData {
            id: 10,
            slug: "news".into(),
            name: "お知らせ".into(),
            description: None,
            parent_id: None,
            sort_order: 0,
        }],
        tags: vec![TermData {
            id: 20,
            slug: "rust".into(),
            name: "Rust".into(),
            description: None,
            parent_id: None,
            sort_order: 0,
        }],
        redirects: vec![Redirect {
            from_path: "/?p=1".into(),
            to_path: "/posts/hello/".into(),
            status_code: 301,
        }],
        ..Default::default()
    };
    data.settings
        .insert("site.title".into(), "テストサイト".into());
    data.settings
        .insert("site.url".into(), "https://example.com/".into());
    data
}

#[tokio::test(flavor = "multi_thread")]
async fn builds_a_site() {
    let out = build(&sample(), &BuildOptions::default()).await.unwrap();
    let file = |p: &str| {
        String::from_utf8(
            out.files
                .get(p)
                .unwrap_or_else(|| panic!("missing {p}"))
                .clone(),
        )
        .unwrap()
    };

    let home = file("index.html");
    assert!(home.contains("テストサイト"));
    assert!(
        home.contains("/posts/%E6%97%A5%E6%9C%AC%E8%AA%9E/"),
        "non-ASCII slugs are encoded in hrefs"
    );
    assert!(home.contains("/about/"), "pages appear in the nav");
    assert!(
        !home.contains("draft body") && !out.files.contains_key("posts/draft/index.html"),
        "drafts are excluded"
    );

    let hello = file("posts/hello/index.html");
    assert!(hello.contains("<p>本文です。</p>"));
    assert!(hello.contains("data-pagefind-body"));
    assert!(
        hello.contains("https://example.com/posts/hello/"),
        "canonical URL"
    );
    assert!(out.files.contains_key("posts/日本語/index.html"));
    assert!(out.files.contains_key("category/news/index.html"));
    assert!(out.files.contains_key("tag/rust/index.html"));
    assert!(out.files.contains_key("about/index.html"));
    assert!(out.files.contains_key("search/index.html"));
    assert!(out.files.contains_key("404.html"));
    assert!(file("sitemap.xml").contains("<loc>https://example.com/posts/hello/</loc>"));
    assert!(file("feed.xml").contains("<title>タイトル1</title>"));
    assert_eq!(file("_redirects"), "/?p=1 /posts/hello/ 301\n");
    assert!(out.files.keys().any(|k| k == "pagefind/pagefind.js"));
    assert!(out.files.keys().any(|k| k == "pagefind/pagefind-ui.js"));
    assert!(
        out.media.contains("media/2026/10/a b.jpg"),
        "{:?}",
        out.media
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn preview_includes_drafts() {
    let options = BuildOptions {
        include_drafts: true,
        live_reload: true,
        ..Default::default()
    };
    let out = build(&sample(), &options).await.unwrap();
    let draft = String::from_utf8(out.files["posts/draft/index.html"].clone()).unwrap();
    assert!(draft.contains("下書き"));
    assert!(draft.contains("/__zwa/build"));
}

#[tokio::test(flavor = "multi_thread")]
async fn applies_theme_files_and_design_settings() {
    let mut data = sample();
    data.settings
        .insert("theme.accent_color".into(), "#ff0066".into());
    data.settings
        .insert("theme.logo".into(), "/media/2026/10/logo.png".into());
    data.settings.insert(
        "theme.custom_css".into(),
        "body{color:red}</style><script>".into(),
    );
    data.settings
        .insert("theme.footer_text".into(), "<b>フッター</b>".into());
    let mut options = BuildOptions::default();
    options
        .theme_files
        .insert("404.html".into(), b"custom {{ site.title }}".to_vec());
    options
        .theme_files
        .insert("img/bg.png".into(), vec![1, 2, 3]);
    let out = build(&data, &options).await.unwrap();
    let home = String::from_utf8(out.files["index.html"].clone()).unwrap();
    assert!(home.contains("--accent: #ff0066"));
    assert!(home.contains(r#"<img class="site-logo" src="/media/2026/10/logo.png""#));
    assert!(
        !home.contains("</style><script>"),
        "custom CSS cannot close the style block"
    );
    assert!(home.contains("&lt;b&gt;フッター"), "footer text is escaped");
    assert_eq!(out.files["404.html"], "custom テストサイト".as_bytes());
    assert_eq!(out.files["theme/img/bg.png"], vec![1, 2, 3]);
    assert!(out.media.contains("media/2026/10/logo.png"));
}

#[test]
fn rejects_broken_templates() {
    let mut files = std::collections::BTreeMap::new();
    files.insert("base.html".to_string(), b"{% block x %}".to_vec());
    assert!(zwa_site::check_theme(&files).is_err());
}

#[tokio::test(flavor = "multi_thread")]
async fn scheduled_posts_wait_for_their_time() {
    let mut data = sample();
    data.posts[1].published_at = Some("2030-01-01T00:00:00Z".into());
    let options = BuildOptions {
        now: Some("2026-10-27T00:00:00Z".into()),
        ..Default::default()
    };
    let out = build(&data, &options).await.unwrap();
    assert!(!out.files.contains_key("posts/日本語/index.html"));
    let later = BuildOptions {
        now: Some("2030-01-01T00:00:00Z".into()),
        ..Default::default()
    };
    assert!(
        build(&data, &later)
            .await
            .unwrap()
            .files
            .contains_key("posts/日本語/index.html")
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn search_can_be_turned_off() {
    let mut data = sample();
    data.settings.insert("site.search".into(), "off".into());
    let out = build(&data, &BuildOptions::default()).await.unwrap();
    assert!(!out.files.contains_key("search/index.html"));
    assert!(!out.files.keys().any(|k| k.starts_with("pagefind/")));
    let home = String::from_utf8(out.files["index.html"].clone()).unwrap();
    assert!(!home.contains("/search/"));
}

#[tokio::test(flavor = "multi_thread")]
async fn featured_image_is_shown_and_shipped() {
    let mut data = sample();
    data.posts[1].image = Some("/media/2026/10/表紙.jpg".into());
    data.posts[1].image_alt = Some("表紙".into());
    let out = build(&data, &BuildOptions::default()).await.unwrap();
    let html = |p: &str| String::from_utf8(out.files[p].clone()).unwrap();

    let post = html("posts/日本語/index.html");
    assert!(
        post.contains(
            r#"class="entry-image" src="/media/2026/10/%E8%A1%A8%E7%B4%99.jpg" alt="表紙""#
        )
    );
    assert!(post.contains(
        r#"<meta property="og:image" content="https://example.com/media/2026/10/%E8%A1%A8%E7%B4%99.jpg">"#
    ));
    assert!(html("index.html").contains(r#"class="card-image""#));
    assert!(out.media.contains("media/2026/10/表紙.jpg"));
    // Posts without one get no og:image.
    assert!(!html("posts/hello/index.html").contains("og:image"));
}

#[tokio::test(flavor = "multi_thread")]
async fn authors_get_bylines_and_listings() {
    let mut data = sample();
    data.authors = vec![zwa_site::AuthorData {
        id: 1,
        slug: "taro".into(),
        name: "山田太郎".into(),
        bio: Some("週末に記事を書いています。".into()),
    }];
    data.posts[0].author_id = Some(1);
    let out = build(&data, &BuildOptions::default()).await.unwrap();
    let html = |p: &str| String::from_utf8(out.files[p].clone()).unwrap();

    let post = html("posts/hello/index.html");
    assert!(post.contains(r#"<a class="author" href="/author/taro/">山田太郎</a>"#));
    assert!(post.contains("週末に記事を書いています。"));
    assert!(html("author/taro/index.html").contains("著者: 山田太郎"));
    assert!(!html("posts/日本語/index.html").contains("class=\"author"));
}

#[tokio::test(flavor = "multi_thread")]
async fn pages_show_their_form_when_forms_are_enabled() {
    let mut data = sample();
    data.posts[3].form_id = Some(7);
    data.forms = vec![FormData {
        id: 7,
        name: "お問い合わせ".into(),
        fields: vec![
            FormField {
                id: "a1".into(),
                label: "お名前".into(),
                kind: "text".into(),
                required: true,
                options: vec![],
            },
            FormField {
                id: "b2".into(),
                label: "内容".into(),
                kind: "textarea".into(),
                required: false,
                options: vec![],
            },
            FormField {
                id: "c3".into(),
                label: "種類".into(),
                kind: "radio".into(),
                required: true,
                options: vec!["見積もり".into(), "その他".into()],
            },
            FormField {
                id: "d4".into(),
                label: "部署".into(),
                kind: "select".into(),
                required: false,
                options: vec!["営業".into(), "開発".into()],
            },
            FormField {
                id: "e5".into(),
                label: "きっかけ".into(),
                kind: "radio".into(),
                required: false,
                options: vec!["検索".into(), "SNS".into()],
            },
        ],
        submit_label: None,
        success_message: Some("ありがとうございました".into()),
    }];

    // Not enabled (no Turnstile site key): no form.
    let out = build(&data, &BuildOptions::default()).await.unwrap();
    let about = String::from_utf8(out.files["about/index.html"].clone()).unwrap();
    assert!(!about.contains("data-zwa-form"));
    assert!(!out.files.contains_key("assets/zwa-form.js"));

    data.settings
        .insert("forms.turnstile_sitekey".into(), "0xREALKEY".into());
    let out = build(&data, &BuildOptions::default()).await.unwrap();
    let about = String::from_utf8(out.files["about/index.html"].clone()).unwrap();
    assert!(about.contains(r#"action="/_zwa/forms/7""#));
    assert!(about.contains(r#"name="f_a1""#));
    assert!(about.contains(r#"<textarea name="f_b2""#));
    assert!(about.contains(r#"<input type="radio" name="f_c3" value="見積もり" required>"#));
    assert!(about.contains(r#"<option value="開発">開発</option>"#));
    // Only the optional radio group gets the clear button.
    assert_eq!(about.matches("data-zwa-clear").count(), 1);
    assert!(about.contains(r#"data-sitekey="0xREALKEY""#));
    assert!(about.contains("ありがとうございました"));
    assert!(!about.contains("data-preview"));
    assert!(out.files.contains_key("assets/zwa-form.js"));
    // Pages link the content-hashed copies, which are shipped too.
    let linked = |ext: &str| {
        let re =
            regex::Regex::new(&format!(r#""/(assets/v/[0-9a-f]{{10}}/[a-z-]+\.{ext})""#)).unwrap();
        re.captures(&about).map(|c| c[1].to_string()).unwrap()
    };
    assert!(out.files.contains_key(&linked("css")));
    assert!(out.files.contains_key(&linked("js")));

    // Previews use Turnstile's test key and don't send.
    let preview = BuildOptions {
        live_reload: true,
        ..Default::default()
    };
    let out = build(&data, &preview).await.unwrap();
    let about = String::from_utf8(out.files["about/index.html"].clone()).unwrap();
    assert!(about.contains(r#"data-sitekey="1x00000000000000000000AA""#));
    assert!(about.contains("data-preview"));
}
