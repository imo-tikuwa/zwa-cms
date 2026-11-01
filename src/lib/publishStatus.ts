import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PostStatus, PostType } from "./posts";

/** What the published site does not show yet (src-tauri/src/publish.rs). */
export type PublishStatus = {
  /** When the site was last published, if ever. */
  published_at: string | null;
  pending: { id: number; type: PostType; title: string }[];
  settings_changed: boolean;
};

export const publishStatus = () => invoke<PublishStatus>("publish_status");

/**
 * A post as the reader sees it. Saving with "公開する" only marks it for the
 * site; it is on the site after the next "サイトに公開".
 * - draft: not on the site
 * - scheduled: published, but its date is in the future
 * - pending: published and saved since the site was last published, or its
 *   date came after that (a scheduled post that became due)
 * - live: on the site as saved
 */
export type PostState = "draft" | "scheduled" | "pending" | "live";

export function postState(
  p: { id: number; status: PostStatus; published_at: string | null },
  status: PublishStatus | null,
): PostState {
  if (p.status === "draft") return "draft";
  if (p.published_at && p.published_at > new Date().toISOString().replace(/\.\d{3}Z$/, "Z")) return "scheduled";
  if (!status) return "live";
  // Became due after `status` was read, so its pending list can't have it yet.
  if (status.published_at && p.published_at && p.published_at > status.published_at) return "pending";
  return status.pending.some((x) => x.id === p.id) ? "pending" : "live";
}

export const POST_STATE_LABELS: Record<PostState, { label: string; hint: string }> = {
  draft: { label: "下書き", hint: "サイトには載りません" },
  scheduled: { label: "予約", hint: "公開日時を過ぎると、自動でサイトに載ります" },
  pending: { label: "未反映", hint: "左下の「サイトに公開」でサイトに載ります" },
  live: { label: "公開中", hint: "サイトに載っています" },
};

/** What a state means. A scheduled post goes up on its own only with the GitHub link. */
export const stateHint = (state: PostState, scheduling: boolean | null) =>
  state === "scheduled" && scheduling === false
    ? "公開日時を過ぎてから「サイトに公開」すると載ります（自動で載せるには GitHub 連携が必要です）"
    : POST_STATE_LABELS[state].hint;

// Saving a post or publishing the site changes the status; listeners refetch it.
const listeners = new Set<() => void>();
export const onPublishStatusChange = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
export const notifyPublishStatusChange = () => listeners.forEach((fn) => fn());

/** The status, kept fresh across saves and publishes. */
export function usePublishStatus() {
  const [status, setStatus] = useState<PublishStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void publishStatus()
        .then((s) => alive && setStatus(s))
        .catch(() => {});
    load();
    const off = onPublishStatusChange(load);
    // Scheduled posts become due, and GitHub Actions publishes, without
    // anything happening in this window.
    const timer = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      off();
      window.clearInterval(timer);
    };
  }, []);
  return status;
}
