-- Initial schema.
--
-- Conventions:
--   - Timestamps are ISO 8601 UTC strings (e.g. 2026-10-25T12:00:00Z).
--   - legacy_wp_id / legacy_url keep the original WordPress identifiers for
--     migration (URL rewriting, redirects, re-imports). NULL for native content.
--   - The app sets updated_at on every update.

-- Site-wide settings (site title, description, permalink format, etc.)
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Bylines shown on the site. Not login accounts.
CREATE TABLE authors (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  bio          TEXT,
  legacy_wp_id INTEGER UNIQUE,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Files stored in R2. The object itself lives at r2_key.
CREATE TABLE media (
  id           INTEGER PRIMARY KEY,
  r2_key       TEXT NOT NULL UNIQUE,
  filename     TEXT NOT NULL,          -- original file name
  mime_type    TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  width        INTEGER,                -- images only
  height       INTEGER,                -- images only
  alt_text     TEXT,
  caption      TEXT,
  sha256       TEXT,                   -- for duplicate detection
  legacy_wp_id INTEGER UNIQUE,
  legacy_url   TEXT,                   -- original WordPress URL, used to rewrite links in imported bodies
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX media_sha256 ON media (sha256);

-- Posts and pages (WordPress post_type 'post' / 'page').
CREATE TABLE posts (
  id                INTEGER PRIMARY KEY,
  type              TEXT NOT NULL CHECK (type IN ('post', 'page')),
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  slug              TEXT NOT NULL,
  title             TEXT NOT NULL,
  body              TEXT NOT NULL DEFAULT '',
  -- Imported WordPress content stays as HTML; new content is Markdown.
  body_format       TEXT NOT NULL DEFAULT 'markdown' CHECK (body_format IN ('markdown', 'html')),
  excerpt           TEXT,
  parent_id         INTEGER REFERENCES posts (id) ON DELETE SET NULL,  -- pages only
  sort_order        INTEGER NOT NULL DEFAULT 0,                        -- pages only
  author_id         INTEGER REFERENCES authors (id) ON DELETE SET NULL,
  featured_media_id INTEGER REFERENCES media (id) ON DELETE SET NULL,
  published_at      TEXT,
  legacy_wp_id      INTEGER UNIQUE,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (type, slug),
  CHECK (type = 'page' OR parent_id IS NULL),
  CHECK (status = 'draft' OR published_at IS NOT NULL)
);

CREATE INDEX posts_listing ON posts (type, status, published_at DESC);
CREATE INDEX posts_parent ON posts (parent_id);

-- Hierarchical. A post can belong to multiple categories (same as WordPress).
CREATE TABLE categories (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT,
  parent_id    INTEGER REFERENCES categories (id) ON DELETE SET NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  legacy_wp_id INTEGER UNIQUE,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Flat.
CREATE TABLE tags (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT,
  legacy_wp_id INTEGER UNIQUE,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE post_categories (
  post_id     INTEGER NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, category_id)
);

CREATE INDEX post_categories_category ON post_categories (category_id);

CREATE TABLE post_tags (
  post_id INTEGER NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

CREATE INDEX post_tags_tag ON post_tags (tag_id);

-- Redirects written to the static site's _redirects file at build time.
-- Used to keep old WordPress URLs (e.g. /?p=123, /2020/01/slug/) working.
CREATE TABLE redirects (
  id          INTEGER PRIMARY KEY,
  from_path   TEXT NOT NULL UNIQUE,
  to_path     TEXT NOT NULL,
  status_code INTEGER NOT NULL DEFAULT 301 CHECK (status_code IN (301, 302)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
