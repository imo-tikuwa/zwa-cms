import { invoke } from "@tauri-apps/api/core";

export type PostType = "post" | "page";
export type PostStatus = "draft" | "published";
export type BodyFormat = "markdown" | "html";

/** How the body editor opens: visual (WYSIWYG) or the Markdown/HTML source. */
export type EditorMode = "visual" | "source";
const EDITOR_MODE_KEY = "zwa.editor.mode";

/** Chosen per machine in the app settings. */
export function defaultEditorMode(): EditorMode {
  try {
    return localStorage.getItem(EDITOR_MODE_KEY) === "source" ? "source" : "visual";
  } catch {
    return "visual";
  }
}
export function setDefaultEditorMode(mode: EditorMode) {
  try {
    localStorage.setItem(EDITOR_MODE_KEY, mode);
  } catch {
    // Not fatal.
  }
}

export type PostSummary = {
  id: number;
  title: string;
  slug: string;
  status: PostStatus;
  body_format: BodyFormat;
  parent_id: number | null;
  sort_order: number;
  published_at: string | null;
  updated_at: string;
  category_ids: number[];
  tag_ids: number[];
};

export type Post = {
  id: number;
  type: PostType;
  status: PostStatus;
  slug: string;
  title: string;
  body: string;
  body_format: BodyFormat;
  excerpt: string | null;
  parent_id: number | null;
  sort_order: number;
  published_at: string | null;
  updated_at: string;
  category_ids: number[];
  tag_ids: number[];
  featured_media_id: number | null;
  author_id: number | null;
  /** Contact form shown under the body (pages only). */
  form_id: number | null;
  /** Public path (`/media/...`) of the featured image, for display. */
  featured_image: string | null;
};

export type PostInput = Omit<Post, "id" | "updated_at"> & {
  id: number | null;
  updated_at: string | null;
};

export const listPosts = (kind: PostType) => invoke<PostSummary[]>("posts_list", { kind });

export const getPost = (id: number) => invoke<Post>("post_get", { id });

export const savePost = (input: PostInput) => invoke<Post>("post_save", { input });

export const deletePost = (id: number) => invoke<void>("post_delete", { id });

export const newPost = (type: PostType): PostInput => ({
  id: null,
  updated_at: null,
  type,
  status: "draft",
  slug: "",
  title: "",
  body: "",
  body_format: "markdown",
  excerpt: null,
  parent_id: null,
  sort_order: 0,
  published_at: null,
  category_ids: [],
  tag_ids: [],
  featured_media_id: null,
  author_id: null,
  form_id: null,
  featured_image: null,
});

export const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" }) : "";
