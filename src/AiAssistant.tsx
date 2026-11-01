import { useEffect, useRef, useState } from "react";
import { Check, Copy, Sparkles, Undo2 } from "lucide-react";
import {
  ActionIcon,
  Badge,
  Button,
  CloseButton,
  Code,
  Group,
  Loader,
  Modal,
  Popover,
  Stack,
  Text,
  Textarea,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { Alert } from "./ui/Alert";
import {
  AiSettings,
  DiffLine,
  PostContext,
  Task,
  aiStatus,
  cancelAi,
  diffLines,
  getAiSettings,
  newRequestId,
  runAi,
} from "./lib/ai";
import { listCategories, listTags, saveTag, suggestSlug } from "./lib/taxonomy";
import { MessageText } from "./ui/CopyButton";

const FIELD_BUTTONS_KEY = "zwa.ai.fieldButtons";

/** Field ✨ buttons can be hidden per machine (to avoid accidental calls). */
export function fieldButtonsEnabled() {
  try {
    return localStorage.getItem(FIELD_BUTTONS_KEY) !== "off";
  } catch {
    return true;
  }
}
export function setFieldButtonsEnabled(on: boolean) {
  try {
    localStorage.setItem(FIELD_BUTTONS_KEY, on ? "on" : "off");
  } catch {
    // Not fatal.
  }
}

/** Whether an API key is registered. */
export function useAiAvailable() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    aiStatus()
      .then((s) => setAvailable(s.has_key))
      .catch(() => setAvailable(false));
  }, []);
  return available;
}

/** Existing category/tag names, sent so suggestions can reuse them. */
async function withTerms(post: PostContext): Promise<PostContext> {
  const [categories, tags] = await Promise.all([listCategories(), listTags()]);
  return { ...post, categories: categories.map((c) => c.name), tags: tags.map((t) => t.name) };
}

/** Runs one task with cancel support and a streamed character count. */
function useAiTask() {
  const [running, setRunning] = useState(false);
  const [chars, setChars] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<string | null>(null);

  useEffect(() => () => void (current.current && cancelAi(current.current)), []);

  const run = async <T,>(task: Task, post: PostContext): Promise<T | null> => {
    const id = newRequestId();
    current.current = id;
    setRunning(true);
    setChars(0);
    setError(null);
    try {
      return await runAi<T>(id, task, post, (t) => setChars((n) => n + t.length));
    } catch (err) {
      setError(String(err));
      return null;
    } finally {
      if (current.current === id) current.current = null;
      setRunning(false);
    }
  };
  const cancel = () => current.current && void cancelAi(current.current);
  return { run, cancel, running, chars, error, setError };
}

function Progress({ chars, onCancel }: { chars: number; onCancel: () => void }) {
  return (
    <Group gap="xs" wrap="nowrap">
      <Loader size={14} />
      <Text size="sm" c="dimmed">
        {chars > 0 ? `生成中…（${chars.toLocaleString()} 文字）` : "考えています…"}
      </Text>
      <Button size="compact-xs" variant="subtle" color="gray" onClick={onCancel}>
        中止
      </Button>
    </Group>
  );
}

// ---------- Field buttons ----------

type FieldButtonProps = {
  title: string;
  /** Produces candidates; called only when the button is pressed. */
  generate: (run: ReturnType<typeof useAiTask>["run"]) => Promise<string[] | null>;
  onPick: (value: string) => void;
};

/**
 * Small ✨ button next to a field. Pressing it only shows candidates;
 * nothing changes until one is clicked.
 */
export function FieldAiButton({ title, generate, onPick }: FieldButtonProps) {
  const ai = useAiTask();
  const [candidates, setCandidates] = useState<string[] | null>(null);
  const open = ai.running || candidates !== null || ai.error !== null;

  const start = async () => {
    setCandidates(null);
    const result = await generate(ai.run);
    if (result) setCandidates(result);
  };
  const close = () => {
    if (ai.running) ai.cancel();
    setCandidates(null);
    ai.setError(null);
  };

  return (
    <Popover opened={open} onChange={(o) => !o && close()} position="bottom-end" width={340} shadow="md" withinPortal>
      <Popover.Target>
        <Tooltip label={title} disabled={open}>
          <ActionIcon variant="subtle" size="sm" aria-label={title} onClick={open ? close : start}>
            {ai.running ? <Loader size={12} /> : <Sparkles size={15} />}
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Group justify="space-between" wrap="nowrap">
            <Text size="xs" fw={600} c="dimmed">
              {title}
            </Text>
            <CloseButton size="sm" aria-label="閉じる" onClick={close} />
          </Group>
          {ai.running && <Progress chars={ai.chars} onCancel={ai.cancel} />}
          {ai.error && (
            <MessageText size="sm" error>
              {ai.error}
            </MessageText>
          )}
          {candidates && (
            <Stack gap={2}>
              {candidates.map((c) => (
                <UnstyledButton
                  key={c}
                  className="candidate"
                  onClick={() => {
                    onPick(c);
                    setCandidates(null);
                  }}
                >
                  {c}
                </UnstyledButton>
              ))}
            </Stack>
          )}
          {candidates && (
            <div>
              <Button size="xs" variant="subtle" leftSection={<Sparkles size={14} />} onClick={start}>
                別の案を出す
              </Button>
            </div>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

/** Title and slug candidates come from one request; share it between fields. */
export function titleSlugGenerator(post: () => PostContext, field: "titles" | "slugs") {
  return async (run: ReturnType<typeof useAiTask>["run"]) => {
    const r = await run<{ titles: string[]; slugs: string[] }>({ kind: "title_slug" }, post());
    return r ? (field === "slugs" ? r.slugs.map((s) => suggestSlug(s)) : r.titles) : null;
  };
}

export function excerptGenerator(post: () => PostContext) {
  return async (run: ReturnType<typeof useAiTask>["run"]) => {
    const r = await run<{ excerpt: string }>({ kind: "excerpt" }, post());
    return r ? [r.excerpt] : null;
  };
}

// ---------- Assistant panel ----------

type Result =
  | { kind: "body"; label: string; before: string; after: string }
  | { kind: "text"; label: string; text: string }
  | { kind: "excerpt"; text: string }
  | { kind: "title_slug"; titles: string[]; slugs: string[] }
  | { kind: "terms"; categories: string[]; tags: string[] };

type PanelProps = {
  post: PostContext;
  isPost: boolean;
  onApplyBody: (body: string) => void;
  onApplyExcerpt: (excerpt: string) => void;
  onApplyTitle: (title: string) => void;
  onApplySlug: (slug: string) => void;
  onAddCategories: (names: string[]) => void;
  onAddTags: (names: string[]) => void;
  onClose: () => void;
};

export function AiPanel(props: PanelProps) {
  const { post } = props;
  const ai = useAiTask();
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  // Body before the last applied change, for "元に戻す".
  const [undo, setUndo] = useState<string | null>(null);

  useEffect(() => {
    getAiSettings()
      .then(setSettings)
      .catch((err) => ai.setError(String(err)));
  }, []);

  const empty = !post.body.trim();

  const start = async (task: Task, label: string) => {
    setResult(null);
    if (task.kind === "proofread") {
      const r = await ai.run<{ text: string }>(task, post);
      if (r) setResult({ kind: "body", label, before: post.body, after: r.text });
    } else if (task.kind === "excerpt") {
      const r = await ai.run<{ excerpt: string }>(task, post);
      if (r) setResult({ kind: "excerpt", text: r.excerpt });
    } else if (task.kind === "title_slug") {
      const r = await ai.run<{ titles: string[]; slugs: string[] }>(task, post);
      if (r) setResult({ kind: "title_slug", titles: r.titles, slugs: r.slugs.map((s) => suggestSlug(s)) });
    } else if (task.kind === "terms") {
      const r = await ai.run<{ categories: string[]; tags: string[] }>(task, await withTerms(post));
      if (r) setResult({ kind: "terms", ...r });
    } else if (task.kind === "custom") {
      const prompt = settings?.prompts.find((p) => p.id === task.prompt_id);
      const r = await ai.run<{ text: string }>(task, post);
      if (r && prompt)
        setResult(
          prompt.target === "body"
            ? { kind: "body", label, before: post.body, after: r.text }
            : { kind: "text", label, text: r.text },
        );
    }
  };

  const actions: { task: Task; label: string; help: string; needsBody: boolean; postOnly?: boolean }[] = [
    { task: { kind: "proofread" }, label: "添削", help: "誤字脱字や分かりにくい表現を直します", needsBody: true },
    { task: { kind: "excerpt" }, label: "抜粋を作る", help: "記事一覧に出る紹介文を作ります", needsBody: true },
    { task: { kind: "title_slug" }, label: "タイトル・スラッグ案", help: "候補を 5 つずつ出します", needsBody: true },
    {
      task: { kind: "terms" },
      label: "カテゴリー・タグ案",
      help: "既存のものを優先して提案します",
      needsBody: true,
      postOnly: true,
    },
  ];

  return (
    <Stack className="ai-panel" gap="md">
      <Group gap="xs" wrap="nowrap">
        <Sparkles size={16} color="var(--accent)" />
        <Text fw={700}>AI アシスタント</Text>
        <CloseButton ml="auto" aria-label="閉じる" title="閉じる" onClick={props.onClose} />
      </Group>
      {empty && (
        <Text size="sm" c="dimmed">
          本文を書くと使えるようになります。新しい記事は「AI で下書きを作成」から作ることもできます。
        </Text>
      )}
      <Stack gap={6}>
        {actions
          .filter((a) => !a.postOnly || props.isPost)
          .map((a) => (
            <UnstyledButton
              key={a.label}
              className="ai-action"
              disabled={ai.running || (a.needsBody && empty)}
              onClick={() => start(a.task, a.label)}
            >
              <Text size="sm" fw={600}>
                {a.label}
              </Text>
              <Text size="xs" c="dimmed">
                {a.help}
              </Text>
            </UnstyledButton>
          ))}
        {settings?.prompts.map((p) => (
          <UnstyledButton
            key={p.id}
            className="ai-action"
            disabled={ai.running || empty}
            onClick={() => start({ kind: "custom", prompt_id: p.id }, p.name)}
          >
            <Text size="sm" fw={600}>
              {p.name}
            </Text>
            <Text size="xs" c="dimmed">
              {p.target === "body" ? "本文と入れ替え" : "読むだけ"}
            </Text>
          </UnstyledButton>
        ))}
      </Stack>
      {ai.running && <Progress chars={ai.chars} onCancel={ai.cancel} />}
      {ai.error && <Alert level="error">{ai.error}</Alert>}
      {undo !== null && !result && (
        <Group gap="xs">
          <Text size="sm" c="dimmed">
            本文に反映しました。
          </Text>
          <Button
            size="xs"
            variant="subtle"
            leftSection={<Undo2 size={14} />}
            onClick={() => {
              props.onApplyBody(undo);
              setUndo(null);
            }}
          >
            元に戻す
          </Button>
        </Group>
      )}
      {result && (
        <ResultView result={result} {...props} onDone={() => setResult(null)} onBodyApplied={(before) => setUndo(before)} />
      )}
    </Stack>
  );
}

function ResultView({
  result,
  onDone,
  onBodyApplied,
  ...props
}: PanelProps & { result: Result; onDone: () => void; onBodyApplied: (before: string) => void }) {
  const [busy, setBusy] = useState(false);
  const discard = (
    <Button size="xs" onClick={onDone}>
      破棄
    </Button>
  );

  if (result.kind === "body") {
    const diff = diffLines(result.before, result.after);
    const changed = diff.some((d) => d.kind !== "same");
    return (
      <Stack className="ai-result" gap="xs">
        <Text size="sm" fw={700}>
          {result.label}の結果
        </Text>
        {changed ? (
          <DiffView lines={diff} />
        ) : (
          <Text size="sm" c="dimmed">
            変更はありませんでした。
          </Text>
        )}
        <Group gap="xs">
          {changed && (
            <Button
              size="xs"
              variant="filled"
              leftSection={<Check size={14} />}
              onClick={() => {
                props.onApplyBody(result.after);
                onBodyApplied(result.before);
                onDone();
              }}
            >
              本文に適用
            </Button>
          )}
          {discard}
        </Group>
      </Stack>
    );
  }
  if (result.kind === "text") {
    return (
      <Stack className="ai-result" gap="xs">
        <Text size="sm" fw={700}>
          {result.label}の結果
        </Text>
        <div className="ai-text selectable">{result.text}</div>
        <Group gap="xs">
          <Button size="xs" leftSection={<Copy size={14} />} onClick={() => void navigator.clipboard.writeText(result.text)}>
            コピー
          </Button>
          <Button size="xs" onClick={onDone}>
            閉じる
          </Button>
        </Group>
      </Stack>
    );
  }
  if (result.kind === "excerpt") {
    return (
      <Stack className="ai-result" gap="xs">
        <Text size="sm" fw={700}>
          抜粋の案
        </Text>
        <div className="ai-text selectable">{result.text}</div>
        <Group gap="xs">
          <Button
            size="xs"
            variant="filled"
            leftSection={<Check size={14} />}
            onClick={() => {
              props.onApplyExcerpt(result.text);
              onDone();
            }}
          >
            抜粋に適用
          </Button>
          {discard}
        </Group>
      </Stack>
    );
  }
  if (result.kind === "title_slug") {
    return (
      <Stack className="ai-result" gap="xs">
        <Text size="sm" fw={700}>
          タイトルの案（クリックで適用）
        </Text>
        {result.titles.map((t) => (
          <UnstyledButton key={t} className="candidate" onClick={() => props.onApplyTitle(t)}>
            {t}
          </UnstyledButton>
        ))}
        <Text size="sm" fw={700}>
          スラッグの案（クリックで適用）
        </Text>
        {result.slugs.map((s) => (
          <UnstyledButton key={s} className="candidate" onClick={() => props.onApplySlug(s)}>
            <Code>{s}</Code>
          </UnstyledButton>
        ))}
        <Group gap="xs">{discard}</Group>
      </Stack>
    );
  }
  return (
    <Stack className="ai-result" gap="xs">
      <Text size="sm" fw={700}>
        カテゴリー・タグの案
      </Text>
      <Group gap={4}>
        {result.categories.map((c) => (
          <Badge key={`c-${c}`} variant="light" tt="none">
            {c}
          </Badge>
        ))}
      </Group>
      {result.categories.length === 0 && (
        <Text size="sm" c="dimmed">
          合うカテゴリーはありませんでした。
        </Text>
      )}
      <Group gap={4}>
        {result.tags.map((t) => (
          <Badge key={`t-${t}`} variant="outline" color="gray" tt="none">
            #{t}
          </Badge>
        ))}
      </Group>
      <Group gap="xs">
        <Button
          size="xs"
          variant="filled"
          leftSection={<Check size={14} />}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            props.onAddCategories(result.categories);
            props.onAddTags(result.tags);
            setBusy(false);
            onDone();
          }}
        >
          すべて追加
        </Button>
        {discard}
      </Group>
      <Text size="xs" c="dimmed">
        新しいタグは追加するときに作ります。
      </Text>
    </Stack>
  );
}

function DiffView({ lines }: { lines: DiffLine[] }) {
  // Collapse long unchanged runs so the changes stand out.
  const out: (DiffLine | { kind: "gap"; count: number })[] = [];
  lines.forEach((line, i) => {
    const near = lines.slice(Math.max(0, i - 2), i + 3).some((l) => l.kind !== "same");
    if (line.kind !== "same" || near) out.push(line);
    else {
      const last = out[out.length - 1];
      if (last && last.kind === "gap") last.count++;
      else out.push({ kind: "gap", count: 1 });
    }
  });
  return (
    <div className="diff selectable">
      {out.map((l, i) =>
        l.kind === "gap" ? (
          <div key={i} className="diff-gap">
            … 変更のない {l.count} 行 …
          </div>
        ) : (
          <div key={i} className={`diff-${l.kind}`}>
            <span className="diff-mark">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
            {l.text || " "}
          </div>
        ),
      )}
    </div>
  );
}

// ---------- Draft ----------

export type Draft = { title: string; slug: string; excerpt: string; body: string; tags: string[] };

/** Asks for a topic/notes and generates a whole draft. */
export function DraftDialog({ onDone, onClose }: { onDone: (d: Draft) => void; onClose: () => void }) {
  const ai = useAiTask();
  const [brief, setBrief] = useState("");

  const start = async () => {
    const post = await withTerms({ title: "", body: "", body_format: "markdown" });
    const r = await ai.run<Draft>({ kind: "article", brief }, post);
    if (r) onDone({ ...r, slug: suggestSlug(r.slug) });
  };

  return (
    <Modal
      opened
      onClose={() => !ai.running && onClose()}
      closeOnClickOutside={!ai.running}
      closeOnEscape={!ai.running}
      size="lg"
      title={
        <Group gap="xs">
          <Sparkles size={16} color="var(--accent)" />
          <Text fw={600}>AI で下書きを作成</Text>
        </Group>
      }
    >
      <Stack gap="md">
        <Textarea
          label="テーマ・メモ"
          description="箇条書きのメモでも構いません。タイトル・本文・抜粋・タグの案を作り、この記事に入れます（保存はされません）。"
          autosize
          minRows={8}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder={"例: 週末に行った京都旅行について。清水寺と金閣寺、抹茶スイーツ。初めての人向けに回り方のコツも。"}
          data-autofocus
        />
        {ai.running && <Progress chars={ai.chars} onCancel={ai.cancel} />}
        {ai.error && <Alert level="error">{ai.error}</Alert>}
        <Group justify="flex-end" gap="sm">
          <Button disabled={ai.running} onClick={onClose}>
            キャンセル
          </Button>
          <Button variant="filled" leftSection={<Sparkles size={16} />} disabled={ai.running || !brief.trim()} onClick={start}>
            作成する
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Resolves tag names to ids, creating tags that don't exist yet. */
export async function tagIdsFor(names: string[]): Promise<number[]> {
  const tags = await listTags();
  const ids: number[] = [];
  for (const name of names.map((n) => n.trim()).filter(Boolean)) {
    const found = tags.find((t) => t.name === name);
    if (found) ids.push(found.id);
    else ids.push(await saveTag({ id: null, name, slug: suggestSlug(name), description: null }));
  }
  return ids;
}

/** Resolves category names to ids (existing categories only). */
export async function categoryIdsFor(names: string[]): Promise<number[]> {
  const categories = await listCategories();
  return names.flatMap((n) => categories.filter((c) => c.name === n.trim()).map((c) => c.id));
}
