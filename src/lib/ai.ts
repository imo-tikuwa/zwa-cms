import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { trackBusy } from "./busy";

export type CustomPrompt = { id: string; name: string; prompt: string; target: "body" | "panel" };
/** `model` is empty when the site follows this PC's default model. */
export type AiSettings = { model: string; guidelines: string; prompts: CustomPrompt[] };
export type AiStatus = { has_key: boolean; default_model: string; models: string[] };

export type PostContext = {
  title: string;
  body: string;
  body_format: "markdown" | "html";
  categories?: string[];
  tags?: string[];
};

export type Task =
  | { kind: "proofread" }
  | { kind: "excerpt" }
  | { kind: "title_slug" }
  | { kind: "terms" }
  | { kind: "article"; brief: string }
  | { kind: "custom"; prompt_id: string };

export const MODEL_LABELS: Record<string, string> = {
  "claude-opus-5-5": "Claude Opus 5.5（標準・おすすめ）",
  "claude-sonnet-5-5": "Claude Sonnet 5.5（速い・安い）",
  "claude-haiku-5-5": "Claude Haiku 5.5（最速・最安）",
  "claude-fable-5-1": "Claude Fable 5.1（最高性能・高価）",
};

/**
 * USD per million tokens (Claude API list prices, 2026-10), for the usage
 * estimate. Fallback models that may answer after a refusal are included.
 * Cache writes are priced as 5-minute writes (1.25x input).
 */
export const MODEL_PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export type AiUsageRow = {
  /** YYYY-MM (UTC) */
  month: string;
  model: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};

/** Estimated USD, or null for a model without a known price. */
export function estimateCost(row: AiUsageRow): number | null {
  const p = MODEL_PRICES[row.model];
  if (!p) return null;
  return (
    (row.input_tokens * p.input +
      row.output_tokens * p.output +
      row.cache_read_tokens * p.cacheRead +
      row.cache_write_tokens * p.input * 1.25) /
    1_000_000
  );
}

export const aiUsage = () => invoke<AiUsageRow[]>("ai_usage");
export const aiStatus = () => invoke<AiStatus>("ai_status");
export const setAiKey = (key: string) => invoke<AiStatus>("ai_set_key", { key });
export const deleteAiKey = () => invoke<AiStatus>("ai_delete_key");
export const setDefaultModel = (model: string) => invoke<AiStatus>("ai_set_default_model", { model });
export const getAiSettings = () => invoke<AiSettings>("ai_settings_get");
export const saveAiSettings = (settings: AiSettings) => invoke<void>("ai_settings_save", { settings });
export const cancelAi = (requestId: string) => invoke<void>("ai_cancel", { requestId });

/**
 * Runs a task. `onText` receives streamed text as it arrives (useful to
 * show progress); the promise resolves with the final result.
 */
export async function runAi<T = Record<string, unknown>>(
  requestId: string,
  task: Task,
  post: PostContext,
  onText?: (text: string) => void,
): Promise<T> {
  const release = trackBusy("AI の処理");
  try {
    const unlisten = await listen<{ request_id: string; text: string }>("ai-delta", (e) => {
      if (e.payload.request_id === requestId) onText?.(e.payload.text);
    });
    try {
      return await invoke<T>("ai_run", { requestId, task, post });
    } finally {
      unlisten();
    }
  } finally {
    release();
  }
}

export const newRequestId = () => crypto.randomUUID();

/** Line-based diff (LCS), for showing proposed body changes. */
export type DiffLine = { kind: "same" | "add" | "del"; text: string };
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  // Too large for the O(n*m) table: show as a full replacement.
  if (n * m > 4_000_000) {
    return [...a.map((text) => ({ kind: "del" as const, text })), ...b.map((text) => ({ kind: "add" as const, text }))];
  }
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: "del", text: a[i++] });
    } else {
      out.push({ kind: "add", text: b[j++] });
    }
  }
  while (i < n) out.push({ kind: "del", text: a[i++] });
  while (j < m) out.push({ kind: "add", text: b[j++] });
  return out;
}
