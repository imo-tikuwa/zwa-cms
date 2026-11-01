// Mirrors crates/zwa-site/src/urls.rs, to show a post's URL in the editor.

/** "+09:00" -> 540. Defaults to +09:00 like the generator. */
export const parseOffset = (v: string | undefined) => {
  const m = v?.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!m) return 540;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
};

const normalize = (path: string) => {
  const segs = path.split("/").filter(Boolean);
  return segs.length ? `/${segs.join("/")}/` : "/";
};

/** A post's path from the `permalink.post` pattern. Unpublished posts use now. */
export function postPath(pattern: string, post: { id: number | null; slug: string; published_at: string | null }, offsetMinutes: number) {
  const t = new Date((post.published_at ? Date.parse(post.published_at) : Date.now()) + offsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return normalize(
    pattern
      .replace("{slug}", post.slug)
      .replace("{id}", post.id === null ? "（ID）" : String(post.id))
      .replace("{year}", String(t.getUTCFullYear()))
      .replace("{month}", pad(t.getUTCMonth() + 1))
      .replace("{day}", pad(t.getUTCDate())),
  );
}

/** A page's path: its ancestors' slugs, then its own. */
export function pagePath(slug: string, parentId: number | null, pages: { id: number; slug: string; parent_id: number | null }[]) {
  const segs = [slug];
  const seen = new Set<number>();
  let cur = parentId;
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur);
    const parent = pages.find((p) => p.id === cur);
    if (!parent) break;
    segs.unshift(parent.slug);
    cur = parent.parent_id;
  }
  return normalize(segs.join("/"));
}
