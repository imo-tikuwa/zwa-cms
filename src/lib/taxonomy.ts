import { invoke } from "@tauri-apps/api/core";
import { ReadingTracker, romanize } from "./reading";

export type Category = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  parent_id: number | null;
  sort_order: number;
  post_count: number;
};

export type Tag = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  post_count: number;
};

export type TermInput = {
  id: number | null;
  slug: string;
  name: string;
  description: string | null;
  parent_id?: number | null;
  sort_order?: number;
};

export const listCategories = () => invoke<Category[]>("categories_list");
export const saveCategory = (input: TermInput) => invoke<number>("category_save", { input });
export const deleteCategory = (id: number) => invoke<void>("category_delete", { id });

export const listTags = () => invoke<Tag[]>("tags_list");
export const saveTag = (input: TermInput) => invoke<number>("tag_save", { input });
export const deleteTag = (id: number) => invoke<void>("tag_delete", { id });

/** Authors share the tag shape; `description` is the author's bio. */
export const listAuthors = () => invoke<Tag[]>("authors_list");
export const saveAuthor = (input: TermInput) => invoke<number>("author_save", { input });
export const deleteAuthor = (id: number) => invoke<void>("author_delete", { id });

const kebab = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[/?#%]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Suggests a slug from a name: ASCII names are kebab-cased. With the name's
 * reading as typed (src/lib/reading.ts), Japanese becomes romaji; without one
 * it is kept as-is.
 */
export const suggestSlug = (name: string, reading?: ReadingTracker) => {
  if (reading && /[^\x00-\x7f]/.test(name)) {
    const romaji = kebab(romanize(reading.readingOf(name)).replace(/[^A-Za-z0-9\s_-]+/g, " "));
    if (romaji) return romaji;
  }
  return kebab(name);
};

/** Flattens categories into display order with their depth. */
export const categoryTree = (categories: Category[]) => {
  const out: { category: Category; depth: number }[] = [];
  const known = new Set(categories.map((c) => c.id));
  const walk = (parent: number | null, depth: number) => {
    for (const c of categories) {
      // Orphans (parent missing) are shown at the top level.
      const p = c.parent_id !== null && known.has(c.parent_id) ? c.parent_id : null;
      if (p === parent) {
        out.push({ category: c, depth });
        walk(c.id, depth + 1);
      }
    }
  };
  walk(null, 0);
  return out;
};
