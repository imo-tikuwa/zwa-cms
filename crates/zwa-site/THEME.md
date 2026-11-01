# テーマの作り方

このフォルダは ZWA CMS のテーマです。HTML テンプレートと CSS を編集して、サイトの見た目を変えられます。

## 使い方

1. このフォルダのファイルを編集します
2. アプリの「テーマ」画面で、このフォルダを「作業用フォルダ」に指定します。プレビューにすぐ反映されます（この PC だけ）
3. 仕上がったら「フォルダからアップロード」でサイトに保存します。公開にはアップロードしたテーマが使われます

使わないファイルは削除して構いません。削除したファイルには既定のテーマが使われます。

## ファイル

| ファイル | 用途 |
|---|---|
| `base.html` | 全ページ共通の枠（head、ヘッダー、フッター） |
| `list.html` | トップページ、カテゴリー・タグの記事一覧 |
| `post.html` | 記事 |
| `page.html` | 固定ページ |
| `search.html` | サイト内検索（`/search/`） |
| `404.html` | ページが見つからないとき |
| `form.html` | 問い合わせフォーム（`page.html` から読み込み） |
| `style.css` | `/assets/style.css` として出力されます。テンプレートからは `{{ asset("style.css") }}` で参照してください（中身のハッシュを含む URL になり、ブラウザに長く保存されます） |

上記以外の `.html` は部品として `{% include "header.html" %}` などで読み込めます。画像やフォントなど `.html` / `style.css` 以外のファイルは `/theme/<パス>` で公開されます（例: `img/bg.png` → `/theme/img/bg.png`）。

## テンプレートの書き方

[Jinja2](https://jinja.palletsprojects.com/) 互換の記法（[MiniJinja](https://docs.rs/minijinja/)）です。

- `{{ 変数 }}` は自動で HTML エスケープされます。本文（`post.content` / `page.content`）はエスケープされません
- URL を `href` / `src` に入れるときは `{{ post.url | url }}` のように `url` フィルターを通します（日本語のスラッグをエンコードします）
- `{% extends "base.html" %}` と `{% block content %}…{% endblock %}` でページを作ります
- `base.html` のブロック: `title`（`<title>`）、`meta` / `head`（`<head>` 内）、`hero`（ヘッダーの下に全幅で出す部分。既定のテーマではトップページの見出し）、`main_class`（本文の列のクラス。`wide` で一覧向けの広い幅）、`content`（本文）

## 使える変数

すべてのページ:

| 変数 | 内容 |
|---|---|
| `site.title` / `site.description` / `site.url` / `site.language` | サイト情報 |
| `site.nav` | 親のない固定ページ（`title`, `url`）の一覧 |
| `site.search` | サイト内検索が有効なら true（無効なら `/search/` と検索用の索引は出力されません） |
| `site.categories` | 記事のあるカテゴリー（`title`, `url`）の一覧 |
| `site.accent_color` / `site.logo` / `site.favicon` / `site.footer_text` / `site.custom_css` | 「テーマ」画面のデザイン設定（未設定なら空） |
| `site.color_mode` | ライト・ダークの設定。`"system"`（閲覧者の OS に合わせる）/ `"light"` / `"dark"` |
| `site.brightness` | 明るさの設定。`"-1"`（暗め）/ `"0"` / `"1"`（明るめ） |
| `site.color_switch` | 閲覧者が切り替えられるなら true。上の 2 つは最初の表示になる |
| `drafts` | プレビューで下書きを含むとき true |
| `canonical` | このページの絶対 URL（サイトの URL が分かるとき） |
| `og_image` | 記事・固定ページのアイキャッチ画像の絶対 URL（`og:image` 用。画像とサイトの URL があるとき。`url` フィルターを通す） |

`list.html`: `heading`（カテゴリー名など。トップは空）、`posts`（`title`, `url`, `date`, `datetime`, `excerpt`, `draft`, `categories`, `image`, `author`）、`pagination`（`current`, `total`, `prev_url`, `next_url`）

`post.html`: `post`（`title`, `content`, `date`, `datetime`, `draft`, `categories`, `tags`, `description`, `image`, `author`）、`newer` / `older`（`title`, `url`）

`page.html`: `page`（`title`, `content`, `draft`, `description`, `image`）、`breadcrumbs` / `children`（`title`, `url` の一覧）、`form`（問い合わせフォーム。下記）

`image` はアイキャッチ画像（`src`, `alt`）で、未設定なら空です。`src` は `/media/...` のパスなので `url` フィルターを通します。ここで参照した画像は、本文の画像と同じく公開時にサイトへ含まれます。

`author` は記事の著者（`name`, `url`, `bio`）で、未設定なら空です。`url` は著者の記事一覧（`/author/<スラッグ>/`）で、`list.html` で表示されます（`heading` は「著者: 名前」）。

## 問い合わせフォーム

固定ページにフォームが設定されていて、サイトの問い合わせフォームが有効なときだけ、`page.html` に `form` が渡されます。既定のテーマでは `{% include "form.html" %}` で表示しています。`page.html` を上書きする場合は、この行を残してください。

`form`: `action`（送信先。`url` フィルターを通します）、`sitekey`（Turnstile のサイトキー）、`preview`（プレビュー中は送信できません）、`submit_label`、`success_message`、`fields`（`name`, `label`, `type`, `required`, `max`, `options`）。`type` は `text` / `email` / `tel` / `textarea` / `checkbox`（同意など 1 つ）/ `select`（プルダウン）/ `radio` / `checkboxes`（いくつでも選ぶ）で、選択式の 3 つは `options`（選択肢の文字列の一覧）を持ちます。`checkboxes` は同じ `name` のチェックボックスを並べます。

`form.html` を書き換える場合は、送信処理（`{{ asset("zwa-form.js") }}`）が使う次の点を残してください。`<form>` の `data-zwa-form` 属性、`data-msg-*` 属性（送信中・失敗・送信後などのメッセージ）、入力欄の `name`、`_zwa_hp`（ボット対策の、人には見えない入力欄）、`.cf-turnstile` 要素、送信ボタン、`.form-status` 要素です。任意のラジオボタンの「選択を外す」ボタン（`data-zwa-clear` 属性、`<fieldset>` の中）は、何か選んでいる間だけ表示されます。不要なら消してかまいません。

## サイト内検索

記事・固定ページの本文を囲む要素に `data-pagefind-body` を付けると、その範囲が検索の対象になります。`search.html` は `/pagefind/pagefind-ui.js` を読み込んで検索画面を表示しています。

## コードの色分け

本文のコードブロック（```` ```rust ```` のように言語名を書いたもの）は、ビルド時に色分けされます。トークンは highlight.js と同じクラス名の `<span>` で囲まれるので、色はテーマの CSS で付けます（既定のテーマは `style.css` の `--hl-*`）。

使われるクラス: `hljs-keyword` `hljs-string` `hljs-comment` `hljs-number` `hljs-literal` `hljs-title`（関数名） `hljs-built_in` `hljs-type` `hljs-params` `hljs-attr` `hljs-name`（タグ名） `hljs-meta` `hljs-section`（見出し） `hljs-addition` / `hljs-deletion`（diff）

言語名がないものや知らない言語は、色を付けずにそのまま出します。

## ライト・ダークと明るさ

既定のテーマは `<html>` の `data-theme`（`light` / `dark`、なければ OS に合わせる）と `data-brightness`（`-1` / `0` / `1`）で色を切り替えます（`style.css` の先頭）。`base.html` はデザイン設定からこの 2 つを出力し、`site.color_switch` のときはヘッダーに切り替えのメニューを出して、閲覧者の選択をブラウザの `localStorage`（`zwa.colors`）に保存します。

プレビュー（`live_reload`）では、アプリのライト・ダークと明るさを `/__zwa/appearance` から読み、変わったら再読み込みします。独自のテーマで `base.html` を置き換える場合、同じ属性を使えばこの動きをそのまま使えます。
