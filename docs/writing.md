# 記事の書き方

## エディタ

見たまま編集できるエディタで、保存形式は Markdown です。

- `# ` や `- ` など Markdown の記法を入力すると、その場で書式に変わります。Markdown のテキストを貼り付けても整形されます
- 画像は貼り付けやドラッグ＆ドロップで入れられます。R2 に保存され、本文には公開サイトと同じ `/media/...` の URL が入ります
- 表、チェックリスト、コードブロックに対応しています
- Markdown のまま編集する表示にも切り替えられます。本文を開いたときの表示は「アプリの設定」→「編集画面」で選べます

## 記事の状態

ボタンは「下書き保存」と「公開する」の 2 つです。「公開する」は記事に印を付けるだけで、サイトに載るのは「サイトに公開」を押したときです。

| 状態 | 意味 |
|---|---|
| 下書き | サイトには載りません。プレビューには出ます |
| 予約 | 公開日時が未来の記事です。[GitHub 連携](github-actions.md) をしていれば、日時を過ぎると自動でサイトに載ります |
| 未反映 | 公開の印が付いているが、まだサイトに載っていない記事です。「サイトに公開」で載ります |
| 公開中 | サイトに載っています |

左下の「サイトに公開」には、未反映の件数が出ます。サイトの設定やテーマを変えたときも 1 件と数えます。

## サイトの URL

| ページ | URL |
|---|---|
| トップ（記事一覧） | `/`、`/page/2/` … |
| 記事 | 「サイト情報」の「記事のパーマリンク」で設定（既定は `/posts/{slug}/`。`{slug}` `{id}` `{year}` `{month}` `{day}` が使えます） |
| 固定ページ | `/<親ページのスラッグ>/<スラッグ>/` |
| カテゴリー・タグ | `/category/<スラッグ>/`、`/tag/<スラッグ>/` |
| 著者 | `/author/<スラッグ>/` |
| サイト内検索 | `/search/` |

URL を変えた記事は、「サイト情報」→「リダイレクト」で古い URL から転送できます。

## コードの色分け

コードブロックに言語名を書くと（```` ```rust ```` など）、公開サイトとエディタで色分けされます。サイトではビルド時に色を付けるので、閲覧者のブラウザで JavaScript は動きません。

| 言語 | 書き方 |
|---|---|
| Bash・シェル | `bash` `sh` `shell` `zsh` `console` |
| C / C++ / C# | `c` / `cpp` `c++` / `csharp` `cs` |
| CSS / SCSS | `css` / `scss` |
| diff | `diff` |
| Dockerfile | `dockerfile` `docker` |
| Go | `go` `golang` |
| HTML / XML | `html` / `xml` `svg` |
| INI / TOML | `ini` / `toml` |
| Java / Kotlin | `java` / `kotlin` `kt` |
| JavaScript / TypeScript | `javascript` `js` `jsx` / `typescript` `ts` `tsx` |
| JSON | `json` `jsonc` |
| Lua | `lua` |
| Markdown | `markdown` `md` |
| PHP | `php` |
| PowerShell | `powershell` `ps1` `pwsh` |
| Python | `python` `py` |
| Ruby | `ruby` `rb` |
| Rust | `rust` `rs` |
| SQL | `sql` |
| Swift | `swift` |
| YAML | `yaml` `yml` |

公開サイトでは、ほかにも多くの言語（[bat](https://github.com/sharkdp/bat) と同じ構文定義）に色が付きます。言語名がないもの・知らない言語は、色を付けずに表示します。色はテーマの CSS で変えられます。
