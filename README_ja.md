# Zero Web Admin CMS

[English](README.md) | 日本語

<img src="src-tauri/app-icon.png" alt="" width="96" align="right">

公開サイトに管理画面を一切置かない CMS です。略称は ZWA CMS です。

記事の編集は手元のデスクトップアプリで行い、Cloudflare に静的サイトとして公開します。公開サイトにはログイン画面もデータベースへの接続もないため、攻撃される入口がありません。運用費は Cloudflare の無料プランの範囲に収まる想定です。

> [!NOTE]
> 開発中です。仕様やデータ形式は予告なく変わることがあります。

## ほかの CMS との違い

どれが優れているというより、管理画面とデータをどこに置くかの違いです。

| | WordPress | EmDash | 静的サイトジェネレーター（Hugo・Astro など） | ZWA CMS |
|---|---|---|---|---|
| 管理画面 | 公開サイトの中 | 公開サイトの中 | なし（エディタと Git で編集） | 手元のデスクトップアプリ |
| 記事の保存先 | サーバーのデータベース | Cloudflare D1 など | リポジトリのファイル | Cloudflare D1 |
| 公開サイト | サーバーでページを生成 | Workers でページを生成 | 静的ファイル | 静的ファイル |
| 必要なもの | PHP とデータベースが動くサーバー | Cloudflare | 開発環境（Node.js など）と Git | Cloudflare とこのアプリ |
| 拡張 | プラグイン・テーマ | プラグイン・テーマ | コードを書いて自由に | テーマ（プラグインはなし） |

## 特徴

- **管理画面は手元のアプリだけ**: Windows / macOS / Linux 向け。サーバーや Node.js などは不要です
- **Cloudflare にまとめて置く**: 記事は D1、画像は R2 に保存し、サイトは Workers の静的アセットとして配信します。必要なリソースはアプリが作ります
- **見たまま編集できるエディタ**: 保存形式は Markdown。表やコードの色分けにも対応しています
- **その場でプレビュー**: 手元でサイトを生成してブラウザで確認できます。下書きも表示されます
- **日本語のサイト内検索**: ビルド時に索引（[Pagefind](https://pagefind.app/)）を作り、検索はブラウザ内で動きます
- **複数サイト・複数 PC**: 1 つのアプリで複数のサイトを管理でき、別の PC から同じサイトに接続できます
- **必要に応じて**: 問い合わせフォーム、Basic 認証、予約投稿（GitHub 連携）、AI アシスタント（Claude API）

## 始め方

1. Cloudflare でユーザー API トークンを作り、アプリに貼り付けます（[準備](docs/setup.md)）
2. 「サイトを追加」でサイト名とサイト ID を入力すると、D1 と R2 が作られます
3. 記事を書いて、左下の「プレビュー」で確認します
4. 「サイトに公開」で `https://zwa-<サイトID>.<アカウントのサブドメイン>.workers.dev/` に公開されます

## ドキュメント

| | |
|---|---|
| [準備とトークン](docs/setup.md) | 必要なもの、API トークンの作り方、アプリが使うトークン・キーの一覧 |
| [仕組み](docs/architecture.md) | 編集・公開・問い合わせで、どこに何が流れるか |
| [記事の書き方](docs/writing.md) | 記事の状態、URL の構成、コードの色分け |
| [テーマ](docs/themes.md) | デザイン設定とテーマファイル、どこに保存されるか |
| [問い合わせフォーム](docs/forms.md) | フォームの作り方、送信内容の保存先、不正な送信の防ぎ方 |
| [Basic 認証](docs/basic-auth.md) | サイト全体にパスワードをかける |
| [GitHub 連携（予約投稿）](docs/github-actions.md) | 予約投稿の仕組みと使うトークン |
| [AI アシスタント](docs/ai.md) | Claude API を使った添削・下書き |
| [テーマの作り方](crates/zwa-site/THEME.md) | テンプレートと CSS の書き方（テーマ作者向け） |

## 料金

ZWA CMS 自体は無料です。Cloudflare の料金はあなたのアカウントに発生しますが、一般的なブログや企業サイトなら無料プランの範囲に収まる想定です。公開サイトは静的アセットとして配信され、D1・R2 にアクセスするのは編集と公開のときのアプリだけです（問い合わせフォームと Basic 認証を使う場合は Worker も動きます）。最新の料金と無料枠は Cloudflare の公式サイトで確認してください。

ZWA CMS は Cloudflare 専用です。ほかのサービスへの公開には対応していません。

## 開発

必要なもの: Node.js、pnpm、Rust、[Tauri v2 の前提ソフトウェア](https://v2.tauri.app/start/prerequisites/)

```sh
pnpm install
pnpm tauri dev      # 開発起動
pnpm tauri build    # インストーラーの作成
```

| ディレクトリ | 内容 |
|---|---|
| `src/` | 管理画面（React + TypeScript） |
| `src-tauri/` | デスクトップアプリ本体（Rust / Tauri） |
| `crates/zwa-site/` | サイト生成。既定のテーマは `crates/zwa-site/theme/` |
| `crates/zwa-core/` | Cloudflare とのやり取りと公開処理（アプリと CLI で共通） |
| `crates/zwa-cli/` | コマンドラインツール `zwa`（GitHub Actions 向け） |
| `migrations/` | D1 のスキーマ |

`.devcontainer/` に開発用コンテナの定義があります。GitHub 連携で使うサイト用のリポジトリのテンプレートは、別のリポジトリ [zwa-cms-site-template](https://github.com/imo-tikuwa/zwa-cms-site-template) です。

## ライセンス

[MIT](LICENSE)

アプリの画面には Noto Sans JP（[SIL Open Font License 1.1](https://openfontlicense.org/)）を同梱しています。
