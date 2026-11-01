# Zero Web Admin CMS

English | [日本語](README_ja.md)

<img src="src-tauri/app-icon.png" alt="" width="96" align="right">

A CMS with no admin screen on the public site at all. ZWA CMS for short.

You edit in a desktop app on your PC and publish a static site to Cloudflare. The public site has no login page and no database connection, so there is nothing to attack. Running costs are expected to stay within Cloudflare's free plan.

> [!NOTE]
> Under development. Specifications and data formats may change without notice.
> The app and the documentation are in Japanese only for now.

## How it differs from other CMSs

It is less about which is better than about where the admin screen and the data live.

| | WordPress | EmDash | Static site generators (Hugo, Astro, …) | ZWA CMS |
|---|---|---|---|---|
| Admin screen | On the public site | On the public site | None (an editor and Git) | A desktop app on your PC |
| Content stored in | The server's database | Cloudflare D1 and others | Files in a repository | Cloudflare D1 |
| Public site | Pages generated on the server | Pages generated on Workers | Static files | Static files |
| You need | A server running PHP and a database | Cloudflare | A development environment (Node.js, …) and Git | Cloudflare and this app |
| Extending | Plugins, themes | Plugins, themes | Write code | Themes (no plugins) |

## Features

- **The admin screen is an app on your PC**: for Windows, macOS and Linux. No server and no Node.js needed
- **Everything on Cloudflare**: posts in D1, images in R2, the site served as Workers static assets. The app creates the resources
- **WYSIWYG editor**: saves Markdown; tables and syntax highlighting included
- **Instant preview**: the site is generated on your PC and opened in your browser, drafts included
- **Site search that handles Japanese**: an index ([Pagefind](https://pagefind.app/)) built at build time; search runs in the browser
- **Multiple sites and PCs**: manage several sites in one app, and connect to the same site from another PC
- **When you need them**: contact forms, Basic authentication, scheduled posts (GitHub link), an AI assistant (Claude API)

## Getting started

1. Create a Cloudflare user API token and paste it into the app ([setup](docs/setup.md))
2. Add a site with a name and a site ID; a D1 database and an R2 bucket are created
3. Write posts and check them with "プレビュー" (Preview) at the bottom left
4. "サイトに公開" (Publish site) puts the site at `https://zwa-<site ID>.<your account subdomain>.workers.dev/`

## Documentation (Japanese)

| | |
|---|---|
| [Setup and tokens](docs/setup.md) | Requirements, creating the API token, every token and key the app uses |
| [How it works](docs/architecture.md) | What goes where when you edit, publish, and receive form submissions |
| [Writing](docs/writing.md) | Post states, URLs, syntax highlighting |
| [Themes](docs/themes.md) | Design settings and theme files, and where they are stored |
| [Contact forms](docs/forms.md) | Creating forms, where submissions go, spam protection |
| [Basic authentication](docs/basic-auth.md) | A password for the whole site |
| [GitHub link (scheduled posts)](docs/github-actions.md) | How scheduled posts work and the tokens involved |
| [AI assistant](docs/ai.md) | Proofreading and drafts with the Claude API |
| [Making themes](crates/zwa-site/THEME.md) | Templates and CSS, for theme authors |

## Costs

ZWA CMS itself is free. Cloudflare charges, if any, go to your account; a typical blog or company site is expected to stay within the free plan. The public site is served as static assets, and only the app touches D1 and R2, while you edit and publish (a Worker also runs when contact forms or Basic authentication are on). Check Cloudflare's website for current prices and free allowances.

ZWA CMS is for Cloudflare only. Publishing to other services is not supported.

## Development

Requirements: Node.js, pnpm, Rust, and the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)

```sh
pnpm install
pnpm tauri dev      # run in development
pnpm tauri build    # build the installers
```

| Directory | Contents |
|---|---|
| `src/` | The app's UI (React + TypeScript) |
| `src-tauri/` | The desktop app (Rust / Tauri) |
| `crates/zwa-site/` | Site generator. The default theme is in `crates/zwa-site/theme/` |
| `crates/zwa-core/` | Cloudflare access and publishing, shared by the app and the CLI |
| `crates/zwa-cli/` | The `zwa` command-line tool (for GitHub Actions) |
| `migrations/` | D1 schema |

`.devcontainer/` defines a development container. The template for a site's GitHub repository is a separate repository, [zwa-cms-site-template](https://github.com/imo-tikuwa/zwa-cms-site-template).

## License

[MIT](LICENSE)

The app bundles Noto Sans JP ([SIL Open Font License 1.1](https://openfontlicense.org/)).
