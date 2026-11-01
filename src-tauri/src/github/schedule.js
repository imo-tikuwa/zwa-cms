// The site's scheduler Worker (`zwa-<site id>-schedule`), separate from the
// site's own Worker so publishing never touches it. A Cron Trigger runs it
// every few minutes; when a scheduled post has become due since the last
// publish, it starts the publish workflow in the site's GitHub repository.
//
// Bindings: DB (the site's D1), GITHUB_TOKEN (a fine-grained token for only
// the site's repository, Actions and Secrets write), GITHUB_REPO
// ("owner/name"), GITHUB_BRANCH, WORKFLOW.
// It only reads posts and settings, and writes `github.dispatch*` settings.
//
// GitHub only says whether the workflow was started, not whether the publish
// worked. A publish moves `zwa.published_at` past `github.dispatched_at`;
// until then the dispatch is retried, at most MAX_TRIES times in a row.

const NOW = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')";
// A publish usually ends within minutes; after this, a dispatch that did not
// lead to one is tried again.
const RETRY_MS = 30 * 60 * 1000;
const MAX_TRIES = 3;
const GAVE_UP = `GitHub Actions を ${MAX_TRIES} 回起動しましたが、公開が完了しませんでした。Actions の画面で失敗の内容を確認してください。直してから Actions で手動実行するか「サイトに公開」すると、予約投稿の確認を再開します。`;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(check(env));
  },
};

async function check(env) {
  const row = await env.DB.prepare(
    `SELECT ${NOW} AS now,
            (SELECT value FROM settings WHERE key = 'zwa.published_at') AS published_at,
            (SELECT value FROM settings WHERE key = 'github.dispatched_at') AS dispatched_at,
            (SELECT value FROM settings WHERE key = 'github.dispatch_count') AS dispatch_count,
            (SELECT value FROM settings WHERE key = 'github.dispatch_error') AS dispatch_error`,
  ).first();
  // Never published: there is nothing to compare with (and no site yet).
  if (!row?.published_at) return;

  // Started and not published since then.
  const waiting = Boolean(row.dispatched_at && row.dispatched_at > row.published_at);
  const tries = Number(row.dispatch_count) || 0;
  if (!waiting && tries) {
    // A publish came after the last dispatch: start counting afresh.
    await env.DB.prepare(
      "DELETE FROM settings WHERE key = 'github.dispatch_count' OR (key = 'github.dispatch_error' AND value = ?1)",
    )
      .bind(GAVE_UP)
      .run();
  }

  const due = await env.DB.prepare(
    // type is listed so the posts_listing index (type, status, published_at)
    // is used: D1 bills by rows read, and this runs every 5 minutes.
    `SELECT COUNT(*) AS n FROM posts
      WHERE type IN ('post', 'page') AND status = 'published'
        AND published_at > ?1 AND published_at <= ${NOW}`,
  )
    .bind(row.published_at)
    .first();
  if (!due?.n) return;

  // Already asked and that publish has not finished yet.
  if (waiting) {
    if (Date.parse(row.now) - Date.parse(row.dispatched_at) < RETRY_MS) return;
    if (tries >= MAX_TRIES) {
      // Stop: the workflow keeps failing. Written once, not every 5 minutes.
      if (row.dispatch_error !== GAVE_UP) await setSetting(env, "github.dispatch_error", GAVE_UP);
      return;
    }
  }

  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "zwa-cms-schedule",
      },
      body: JSON.stringify({ ref: env.GITHUB_BRANCH }),
    },
  );
  if (res.ok) {
    await setSetting(env, "github.dispatched_at", row.now);
    await setSetting(env, "github.dispatch_count", String(waiting ? tries + 1 : 1));
    await env.DB.prepare("DELETE FROM settings WHERE key = 'github.dispatch_error'").run();
  } else {
    const text = (await res.text()).slice(0, 500);
    await setSetting(env, "github.dispatch_error", `${row.now} HTTP ${res.status}: ${text}`);
  }
}

function setSetting(env, key, value) {
  return env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?1, ?2)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = ${NOW}`,
  )
    .bind(key, value)
    .run();
}
