//! Writes a small Japanese sample site to a directory, for checking the
//! output (and search) by hand: `cargo run -p zwa-site --example sample -- <dir>`
//!
//! Media (`/media/...`) would come from R2; here each one is a generated SVG.
use zwa_site::{AuthorData, BuildOptions, PostData, SiteData, TermData, build};

fn post(id: i64, slug: &str, title: &str, body: &str) -> PostData {
    PostData {
        id,
        kind: "post".into(),
        status: "published".into(),
        slug: slug.into(),
        title: title.into(),
        body: body.into(),
        body_format: "markdown".into(),
        excerpt: None,
        parent_id: None,
        sort_order: 0,
        published_at: Some(format!("2026-10-{id:02}T00:00:00Z")),
        updated_at: "2026-10-26T00:00:00Z".into(),
        category_ids: vec![],
        tag_ids: vec![],
        image: None,
        image_alt: None,
        author_id: None,
        form_id: None,
    }
}

fn term(id: i64, slug: &str, name: &str) -> TermData {
    TermData {
        id,
        slug: slug.into(),
        name: name.into(),
        description: None,
        parent_id: None,
        sort_order: id,
    }
}

const RUST_BODY: &str = r#"静的サイトジェネレーターを Rust で実装しています。検索機能には Pagefind を使います。

## 構成

生成処理は 3 つの段階に分かれています。

1. データベースから記事を読み込む
2. テンプレートで HTML を作る
3. 検索用の索引を作る

> 管理画面を公開サイトに置かないので、攻撃される場所がありません。

## コード

テンプレートの描画は次のように書けます。

```rust
let html = env.get_template("post.html")?.render(context! { post })?;
```

インラインの `code` も使えます。

## 比較

| 方式 | 速さ | 必要なもの |
|---|---|---|
| 内蔵の生成処理 | 速い | なし |
| Astro | 普通 | Node.js |

- 箇条書きの 1 つ目
- 箇条書きの 2 つ目
  - 入れ子の項目

---

詳しくは[公式サイト](https://pagefind.app/)を見てください。"#;

#[tokio::main]
async fn main() {
    let dir = std::env::args().nth(1).expect("output directory");
    let mut posts = vec![
        post(
            1,
            "kyoto",
            "京都旅行の記録",
            "東京から新幹線で京都へ行きました。清水寺と金閣寺を見学し、抹茶のスイーツを食べました。\n\n## 1 日目\n\n朝早くに出発して、昼前には清水寺に着きました。\n\n![清水寺](/media/2026/10/kyoto-2.svg)\n\n## 2 日目\n\n金閣寺は思っていたより小さく感じました。",
        ),
        post(2, "rust", "Rust で静的サイトを作る", RUST_BODY),
        post(
            3,
            "cooking",
            "週末の料理",
            "週末はカレーライスを作りました。玉ねぎをじっくり炒めるのがコツです。",
        ),
        post(
            4,
            "camera",
            "新しいカメラを買いました",
            "軽いミラーレスカメラに買い替えました。散歩のときにも持ち歩けるのがうれしいです。",
        ),
        post(
            5,
            "bread",
            "初めてのパン作り",
            "強力粉とドライイーストでパンを焼きました。発酵に思ったより時間がかかりました。",
        ),
    ];
    let set = |p: &mut PostData, cats: &[i64], tags: &[i64], image: Option<&str>| {
        p.category_ids = cats.to_vec();
        p.tag_ids = tags.to_vec();
        p.image = image.map(Into::into);
        p.author_id = Some(1);
    };
    set(&mut posts[0], &[1], &[1, 2], Some("/media/2026/10/kyoto.svg"));
    set(&mut posts[1], &[2], &[3], None);
    set(&mut posts[2], &[3], &[2], Some("/media/2026/10/curry.svg"));
    set(&mut posts[3], &[2], &[1], Some("/media/2026/10/camera.svg"));
    set(&mut posts[4], &[3], &[], None);
    let mut about = post(10, "about", "このサイトについて", "旅行・料理・技術の記録を書いています。");
    about.kind = "page".into();
    about.published_at = None;
    posts.push(about);

    let mut data = SiteData {
        posts,
        categories: vec![term(1, "travel", "旅行"), term(2, "tech", "技術"), term(3, "food", "料理")],
        tags: vec![term(1, "photo", "写真"), term(2, "weekend", "週末"), term(3, "rust", "Rust")],
        authors: vec![AuthorData {
            id: 1,
            slug: "sample".into(),
            name: "サンプル太郎".into(),
            bio: Some("週末に旅行と料理をしています。".into()),
        }],
        ..Default::default()
    };
    data.settings.insert("site.title".into(), "サンプル".into());
    data.settings.insert("site.description".into(), "旅行・料理・技術の記録".into());
    let out = build(&data, &BuildOptions::default()).await.unwrap();
    let write = |path: &str, bytes: &[u8]| {
        let p = std::path::Path::new(&dir).join(path);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, bytes).unwrap();
    };
    for (path, bytes) in &out.files {
        write(path, bytes);
    }
    for (i, key) in out.media.iter().enumerate() {
        let hue = 30 + i * 70;
        let svg = format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="hsl({hue},45%,70%)"/><stop offset="1" stop-color="hsl({},45%,40%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>"#,
            hue + 40
        );
        write(key, svg.as_bytes());
    }
    println!("{} files, {} media", out.files.len(), out.media.len());
}
