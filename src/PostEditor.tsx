import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { DateTimePicker } from "@mantine/dates";
import { Post, PostInput, PostSummary, PostType, defaultEditorMode, deletePost, getPost, listPosts, newPost, savePost } from "./lib/posts";
import {
  CalendarClock,
  Check,
  ChevronLeft,
  CircleDot,
  Eye,
  ExternalLink,
  ImagePlus,
  Pencil,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getSiteSettings } from "./lib/siteSettings";
import { notifyPublishStatusChange, postState, usePublishStatus } from "./lib/publishStatus";
import { PostStateBadge } from "./ui/PostStateBadge";
import { usePresence } from "./lib/usePresence";
import { pagePath, parseOffset, postPath } from "./lib/permalink";
import {
  AiPanel,
  DraftDialog,
  FieldAiButton,
  categoryIdsFor,
  excerptGenerator,
  fieldButtonsEnabled,
  tagIdsFor,
  titleSlugGenerator,
  useAiAvailable,
} from "./AiAssistant";
import { MediaPicker } from "./MediaPicker";
import { isImage, previewUrl, publicPath } from "./lib/media";
import { RichEditor } from "./RichEditor";
import { TermPicker } from "./TermPicker";
import {
  ActionIcon,
  Badge,
  Box,
  Divider,
  Button,
  Group,
  Image,
  Input,
  NumberInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from "@mantine/core";
import { Alert } from "./ui/Alert";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { Menu } from "./ui/Menu";
import { Tag, listAuthors } from "./lib/taxonomy";
import { Form, formsStatus, listForms } from "./lib/forms";

type Props = {
  type: PostType;
  /** Scheduled posts are on (GitHub link). null while unknown: no limit. */
  scheduling: boolean | null;
  /** null creates a new post. */
  id: number | null;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  /** Called after a successful save or delete. */
  onSaved?: () => void;
  /** For a new page: the contact form to show on it. */
  initialFormId?: number | null;
  /** Path of the saved post (null while new), for the sidebar's preview button. */
  onPreviewPath?: (path: string | null) => void;
  /** Builds the preview and opens this path. */
  onPreview?: (path: string) => void;
};

const toInput = (p: Post): PostInput => ({ ...p });

// The date picker works in this PC's local time ("YYYY-MM-DD HH:mm:ss").
const toLocalInput = (iso: string | null) => (iso ? dayjs(iso).format("YYYY-MM-DD HH:mm:ss") : null);
const fromLocalInput = (v: string | null) =>
  v
    ? dayjs(v)
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z")
    : null;

export function PostEditor({ type, id, onClose, onDirtyChange, onSaved, initialFormId = null, scheduling, onPreviewPath, onPreview }: Props) {
  const [post, setPost] = useState<PostInput | null>(id === null ? { ...newPost(type), form_id: initialFormId } : null);
  /**
   * The post as last loaded or saved. "Unsaved" means the post differs from
   * it, so focusing a field or typing and undoing doesn't count.
   */
  // The status being saved, so only the button that does it shows a spinner (Ctrl+S saves as is).
  const [savingTo, setSavingTo] = useState<PostInput["status"] | null>(null);
  const publish = usePublishStatus();
  const [baseline, setBaseline] = useState<PostInput | null>(post);
  const [source, setSource] = useState(() => defaultEditorMode() === "source");
  /** The body has syntax the visual editor would drop; it stays in the source view. */
  const [unsupported, setUnsupported] = useState(false);
  // Bumped to remount the rich editor when the body changes from outside it.
  const [editorKey, setEditorKey] = useState(0);
  const [pages, setPages] = useState<PostSummary[]>([]);
  const [authors, setAuthors] = useState<Tag[]>([]);
  const [siteSettings, setSiteSettings] = useState<Record<string, string>>({});
  /** null while forms are off. */
  const [forms, setForms] = useState<Form[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pickingImage, setPickingImage] = useState(false);
  const [saved, setSaved] = useState(false);
  const aiAvailable = useAiAvailable();
  const [aiOpen, setAiOpen] = useState(false);
  // The assistant slides in from the right and out again (styles.css .ai-drawer).
  const aiDrawer = usePresence(aiOpen);
  const [draftOpen, setDraftOpen] = useState(false);
  const fieldAi = aiAvailable && fieldButtonsEnabled();

  const dirty = useMemo(
    () => post !== null && baseline !== null && JSON.stringify(post) !== JSON.stringify(baseline),
    [post, baseline],
  );
  useEffect(() => onDirtyChange(dirty), [dirty]);
  /** Changes made for the user (defaults, normalization) are not edits. */
  const adjust = (fn: (p: PostInput) => PostInput) => {
    setPost((p) => (p ? fn(p) : p));
    setBaseline((b) => (b ? fn(b) : b));
  };

  const futureDate = !!post?.published_at && dayjs(post.published_at).isAfter(dayjs());

  useEffect(() => {
    if (id !== null) {
      getPost(id)
        .then((p) => {
          setPost(toInput(p));
          setBaseline(toInput(p));
        })
        .catch((err) => setError(String(err)));
    }
    getSiteSettings()
      .then(setSiteSettings)
      .catch(() => {});
    if (type === "page") {
      listPosts("page")
        .then(setPages)
        .catch(() => {});
      formsStatus()
        .then(async (s) => {
          if (!s.enabled) return;
          const list = await listForms();
          setForms(list);
          // Opened from a form: name the new page after it.
          const form = list.find((f) => f.id === initialFormId);
          if (id === null && form) adjust((p) => (p.title ? p : { ...p, title: form.name }));
        })
        .catch(() => {});
    } else {
      listAuthors()
        .then((list) => {
          setAuthors(list);
          // A single-author site: new posts get that author.
          if (id === null && list.length === 1) adjust((p) => (p.author_id === null ? { ...p, author_id: list[0].id } : p));
        })
        .catch(() => {});
    }
    return () => onDirtyChange(false);
  }, [id, type]);

  const update = (patch: Partial<PostInput>) => {
    setPost((p) => (p ? { ...p, ...patch } : p));
    setSaved(false);
  };

  const pathOf = (p: PostInput) =>
    type === "page"
      ? pagePath(p.slug || "…", p.parent_id, pages)
      : postPath(
          siteSettings["permalink.post"] || "/posts/{slug}/",
          { ...p, slug: p.slug || "…" },
          parseOffset(siteSettings["site.utc_offset"]),
        );
  // The preview shows what is saved, so it follows the saved slug.
  const savedPath = baseline && baseline.id !== null && baseline.slug ? pathOf(baseline) : null;
  useEffect(() => {
    onPreviewPath?.(savedPath);
    return () => onPreviewPath?.(null);
  }, [savedPath]);

  const save = async (status?: PostInput["status"]) => {
    if (!post) return;
    setSavingTo(status ?? post.status);
    setBusy(true);
    setError(null);
    try {
      const result = await savePost({ ...post, status: status ?? post.status });
      setPost(toInput(result));
      setBaseline(toInput(result));
      setSaved(true);
      onSaved?.();
      notifyPublishStatusChange();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
      setSavingTo(null);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (!busy) save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!post) {
    return error ? (
      <Box p="xl">
        <Alert level="error">{error}</Alert>
      </Box>
    ) : (
      <Text c="dimmed" p="xl">
        読み込み中…
      </Text>
    );
  }

  const label = type === "post" ? "記事" : "固定ページ";
  const isNew = post.id === null;
  const context = () => ({ title: post.title, body: post.body, body_format: post.body_format });
  // Replaces the body from outside the editor (AI results), remounting it.
  const applyBody = (body: string) => {
    update({ body });
    setEditorKey((k) => k + 1);
  };
  const addTags = async (names: string[]) => {
    const ids = await tagIdsFor(names);
    setPost((p) => (p ? { ...p, tag_ids: [...new Set([...p.tag_ids, ...ids])] } : p));
  };
  const addCategories = async (names: string[]) => {
    const ids = await categoryIdsFor(names);
    setPost((p) => (p ? { ...p, category_ids: [...new Set([...p.category_ids, ...ids])] } : p));
  };
  // A page cannot be under itself or one of its descendants.
  const isUnderSelf = (p: PostSummary) => {
    let cur: PostSummary | undefined = p;
    // The step limit guards against cycles already in the data.
    for (let i = 0; cur && i <= pages.length; i++) {
      if (cur.id === post.id) return true;
      const parentId: number | null = cur.parent_id;
      cur = pages.find((x) => x.id === parentId);
    }
    return false;
  };
  const parentOptions = pages.filter((p) => !isUnderSelf(p));

  const slugAi = fieldAi && post.body.trim() && (
    <FieldAiButton
      title="スラッグの案を出す"
      generate={titleSlugGenerator(context, "slugs")}
      onPick={(slug) => update({ slug })}
    />
  );
  const excerptAi = fieldAi && post.body.trim() && (
    <FieldAiButton title="抜粋の案を出す" generate={excerptGenerator(context)} onPick={(excerpt) => update({ excerpt })} />
  );

  return (
    <div className="editor">
      <div className="editor-main">
        <div className="editor-bar">
          <Button
            variant="subtle"
            color="gray"
            leftSection={<ChevronLeft size={16} />}
            onClick={onClose}
            className="bar-fixed bar-collapsible-narrow"
            title={`${label}一覧に戻る`}
            aria-label={`${label}一覧に戻る`}
          >
            {label}一覧
          </Button>
          <Divider orientation="vertical" />
          <div className="editor-bar-status">
            {/* As saved: unsaved edits are shown by their own badge. */}
            <PostStateBadge
              className="bar-state"
              scheduling={scheduling}
              state={baseline?.id ? postState({ ...baseline, id: baseline.id }, publish) : "draft"}
            />
            {busy ? (
              <Text size="sm" c="dimmed">
                保存中…
              </Text>
            ) : dirty ? (
              <Tooltip label="保存していない変更があります（Ctrl+S で保存）">
                <Badge color="orange" variant="light" size="lg" tt="none" fw={600} leftSection={<CircleDot size={12} />}>
                  未保存
                </Badge>
              </Tooltip>
            ) : (
              saved && (
                <Group gap={4} c="green.7" className="bar-transient" wrap="nowrap">
                  <Check size={14} />
                  <Text size="sm" fw={500}>
                    保存しました
                  </Text>
                </Group>
              )
            )}
          </div>
          <Group gap="xs" wrap="nowrap" ml="auto" className="bar-fixed">
            <Tooltip
              label={
                savedPath ? "プレビュー（保存した内容をブラウザで表示。下書きも表示されます）" : "プレビュー（一度保存すると使えます）"
              }
            >
              <ActionIcon
                variant="subtle"
                color="gray"
                size="lg"
                aria-label="プレビュー"
                disabled={!savedPath}
                onClick={() => savedPath && onPreview?.(savedPath)}
              >
                <Eye size={18} />
              </ActionIcon>
            </Tooltip>
            {aiAvailable && (
              <Tooltip label={aiOpen ? "AI アシスタントを閉じる" : "AI アシスタント"}>
                <ActionIcon
                  variant={aiOpen ? "light" : "subtle"}
                  color={aiOpen ? undefined : "gray"}
                  size="lg"
                  aria-label="AI アシスタント"
                  aria-pressed={aiOpen}
                  onClick={() => setAiOpen(!aiOpen)}
                >
                  <Sparkles size={18} />
                </ActionIcon>
              </Tooltip>
            )}
            {post.status === "draft" ? (
              <>
                <Button disabled={busy} loading={savingTo === "draft"} onClick={() => save()}>
                  下書き保存
                </Button>
                <Button variant="filled" disabled={busy} loading={savingTo === "published"} onClick={() => save("published")}>
                  公開する
                </Button>
              </>
            ) : (
              <>
                <Button disabled={busy} loading={savingTo === "draft"} onClick={() => save("draft")}>
                  下書きに戻す
                </Button>
                <Button variant="filled" disabled={busy} loading={savingTo === "published"} onClick={() => save()}>
                  更新
                </Button>
              </>
            )}
          </Group>
        </div>
        <div className="editor-scroll">
          <div className="editor-column">
            {error && (
              <Alert level="error" onClose={() => setError(null)}>
                <p style={{ whiteSpace: "pre-wrap" }}>{error}</p>
              </Alert>
            )}
            <TextInput
              label={
                <LabelWithAi
                  label="タイトル"
                  ai={
                    fieldAi &&
                    post.body.trim() && (
                      <FieldAiButton
                        title="タイトルの案を出す"
                        generate={titleSlugGenerator(context, "titles")}
                        onPick={(title) => update({ title })}
                      />
                    )
                  }
                />
              }
              size="lg"
              value={post.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="タイトルを入力"
              autoFocus={isNew}
              styles={{ input: { fontSize: "1.4rem", fontWeight: 700, height: 52 } }}
            />
            <PermalinkBar
              base={(siteSettings["site.url"] ?? "").replace(/\/+$/, "")}
              path={pathOf(post)}
              slug={post.slug}
              published={post.status === "published"}
              onSlug={(slug) => update({ slug })}
              ai={slugAi}
            />
            <Group justify="space-between" align="flex-end" mt={8}>
              <Text fw={600} size="sm">
                本文
              </Text>
              <Group gap="sm">
                {aiAvailable && isNew && !post.body.trim() && (
                  <Button size="xs" variant="light" leftSection={<Sparkles size={14} />} onClick={() => setDraftOpen(true)}>
                    AI で下書きを作成
                  </Button>
                )}
                <Text size="xs" c="dimmed">
                  編集方法
                </Text>
                <SegmentedControl
                  size="xs"
                  className="mode-switch"
                  value={source ? "source" : "visual"}
                  onChange={(v) => {
                    setSource(v === "source");
                    if (v === "visual") {
                      setUnsupported(false);
                      setEditorKey((k) => k + 1);
                    }
                  }}
                  data={[
                    { value: "visual", label: "ビジュアル" },
                    { value: "source", label: post.body_format === "html" ? "HTML" : "Markdown" },
                  ]}
                />
              </Group>
            </Group>
            {post.body_format === "html" && !source && (
              <Alert level="warning">
                WordPress から取り込んだ HTML です。ビジュアル編集で本文を変えると、エディタが扱えない要素（埋め込みや独自の class
                など）は失われます。そのまま残したいときは HTML の表示で編集してください。
              </Alert>
            )}
            {unsupported && source && (
              <Alert level="warning">
                本文に、ビジュアル表示では扱えない書き方が含まれているため、{post.body_format === "html" ? "HTML" : "Markdown"}
                の表示で開きました。この本文はこのまま編集してください（ビジュアル表示にすると、その部分が消えるため切り替わりません）。
              </Alert>
            )}
            {source ? (
              <Textarea
                className="source"
                value={post.body}
                onChange={(e) => update({ body: e.target.value })}
                spellCheck={false}
                autosize
                minRows={20}
                styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)", fontSize: 13 } }}
              />
            ) : (
              <RichEditor
                key={`${post.id}-${editorKey}`}
                value={post.body}
                format={post.body_format}
                onChange={(body) => update({ body })}
                onNormalize={(body, original) =>
                  // Only the saved body: a body just changed (e.g. by AI) stays an edit.
                  adjust((p) => (p.body === original ? { ...p, body } : p))
                }
                onUnsupported={() => {
                  setUnsupported(true);
                  setSource(true);
                }}
              />
            )}
          </div>
        </div>
      </div>

      <aside className="editor-side" hidden={aiDrawer.mounted}>
        <Section title="公開">
          <Text size="xs" c="dimmed">
            「公開する」で保存した内容は、左下の「サイトに公開」を押すとサイトに載ります。下書きはサイトに載りません（プレビューでは確認できます）。
          </Text>
          <DateTimePicker
            label="公開日時"
            description={
              scheduling === false
                ? "空欄なら公開した時点の日時になります。未来の日時（予約投稿）は、サイト情報の「GitHub 連携」で予約投稿を有効にすると選べます。"
                : "空欄なら公開した時点の日時になります。未来の日時にすると、その日時を過ぎると自動でサイトに公開されます（予約投稿。5 分ほど遅れることがあります）。"
            }
            // Without the schedule, nothing later than now (the time too, not just the day).
            maxDate={scheduling === false ? new Date() : undefined}
            error={
              scheduling === false && futureDate
                ? "予約投稿が有効でないため、この日時を過ぎても自動では載りません。日時を過ぎた後の「サイトに公開」で載ります。"
                : undefined
            }
            placeholder="公開した時点"
            valueFormat="YYYY/M/D HH:mm"
            styles={{ input: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }}
            monthLabelFormat="YYYY年M月"
            yearLabelFormat="YYYY年"
            monthsListFormat="M月"
            highlightToday
            // A date picked without a time gets the current time, not midnight.
            // Only when empty: Mantine starts the time field from this even
            // when there is a value, which hid the saved time.
            defaultTimeValue={post.published_at ? undefined : dayjs().format("HH:mm:00")}
            clearable
            leftSection={<CalendarClock size={16} />}
            value={toLocalInput(post.published_at)}
            onChange={(v) => update({ published_at: fromLocalInput(v) })}
            timePickerProps={{ withDropdown: true, format: "24h", minutesStep: 5, popoverProps: { withinPortal: false } }}
            popoverProps={{ withinPortal: true, position: "bottom-end" }}
            submitButtonProps={{ "aria-label": "決定", title: "決定" }}
          />
        </Section>

        {type === "page" && (
          <Section title="ページの位置">
            <Input.Wrapper label="親ページ" description="親ページの下の URL になり、パンくずリストに表示されます。">
              <Box mt={6}>
                <Menu
                  label={parentOptions.find((p) => p.id === post.parent_id)?.title ?? "なし"}
                  items={[
                    { key: "none", label: "なし", checked: post.parent_id == null, onSelect: () => update({ parent_id: null }) },
                    ...parentOptions.map((p) => ({
                      key: String(p.id),
                      label: p.title || "無題",
                      checked: p.id === post.parent_id,
                      onSelect: () => update({ parent_id: p.id }),
                    })),
                  ]}
                />
              </Box>
            </Input.Wrapper>
            <NumberInput
              label="並び順"
              description="小さい順にメニューなどへ並びます。"
              value={post.sort_order}
              onChange={(v) => update({ sort_order: typeof v === "number" ? v : 0 })}
              allowDecimal={false}
            />
          </Section>
        )}

        {type === "post" && (
          <Section title="分類">
            <TermPicker categoryIds={post.category_ids} tagIds={post.tag_ids} onChange={update} />
            {authors.length > 0 && (
              <Input.Wrapper label="著者">
                <Box mt={6}>
                  <Menu
                    label={authors.find((a) => a.id === post.author_id)?.name ?? "なし"}
                    items={[
                      {
                        key: "none",
                        label: "なし",
                        checked: post.author_id == null,
                        onSelect: () => update({ author_id: null }),
                      },
                      ...authors.map((a) => ({
                        key: String(a.id),
                        label: a.name,
                        checked: a.id === post.author_id,
                        onSelect: () => update({ author_id: a.id }),
                      })),
                    ]}
                  />
                </Box>
              </Input.Wrapper>
            )}
          </Section>
        )}

        <Section title="表示">
          <Input.Wrapper
            label="アイキャッチ画像"
            description={`${type === "post" ? "記事一覧のサムネイルと、" : ""}ページの先頭に表示します。SNS で共有したときの画像にもなります。`}
          >
            <Stack gap="xs" mt={6}>
              {post.featured_image && (
                <Image src={previewUrl(post.featured_image)} alt="" radius="sm" className="featured-image" />
              )}
              <Group gap="xs">
                <Button size="xs" leftSection={<ImagePlus size={14} />} onClick={() => setPickingImage(true)}>
                  {post.featured_image ? "変更" : "メディアから選ぶ"}
                </Button>
                {post.featured_image && (
                  <Button
                    size="xs"
                    variant="subtle"
                    color="gray"
                    leftSection={<X size={14} />}
                    onClick={() => update({ featured_media_id: null, featured_image: null })}
                  >
                    外す
                  </Button>
                )}
              </Group>
            </Stack>
          </Input.Wrapper>
          {pickingImage && (
            <MediaPicker
              onPick={(m) => {
                setPickingImage(false);
                if (!isImage(m)) {
                  setError("画像ファイルを選んでください");
                  return;
                }
                update({ featured_media_id: m.id, featured_image: publicPath(m) });
              }}
              onClose={() => setPickingImage(false)}
            />
          )}
          <Textarea
            label={<LabelWithAi label="抜粋" ai={excerptAi} />}
            description="記事一覧や検索結果、SNS の説明文に使います。空欄なら本文の冒頭から作ります。"
            autosize
            minRows={3}
            value={post.excerpt ?? ""}
            onChange={(e) => update({ excerpt: e.target.value })}
          />
          {type === "page" && (forms !== null || post.form_id !== null) && (
            <Input.Wrapper
              label="問い合わせフォーム"
              description="選んだフォームを本文の下に表示します。フォームは左メニューの「問い合わせ」で作ります。"
            >
              <Box mt={6}>
                <Menu
                  label={
                    post.form_id === null
                      ? "表示しない"
                      : (forms?.find((f) => f.id === post.form_id)?.name ?? "（問い合わせフォームが無効です）")
                  }
                  items={[
                    {
                      key: "none",
                      label: "表示しない",
                      checked: post.form_id === null,
                      onSelect: () => update({ form_id: null }),
                    },
                    ...(forms ?? []).map((f) => ({
                      key: String(f.id),
                      label: f.name,
                      checked: f.id === post.form_id,
                      onSelect: () => update({ form_id: f.id }),
                    })),
                  ]}
                />
              </Box>
            </Input.Wrapper>
          )}
        </Section>

        {!isNew && (
          <Box mt="auto" pt="md" style={{ borderTop: "1px solid var(--border)" }}>
            <Button
              variant="subtle"
              color="red"
              leftSection={<Trash2 size={16} />}
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              この{label}を削除
            </Button>
            {confirmDelete && (
              <ConfirmDialog
                title={`${label}を削除しますか？`}
                confirmLabel="削除する"
                danger
                onConfirm={async () => {
                  await deletePost(post.id!);
                  setBaseline(post);
                  onSaved?.();
                  notifyPublishStatusChange();
                  onClose();
                }}
                onClose={() => setConfirmDelete(false)}
              >
                <Text size="sm">「{post.title || "無題"}」を削除します。元に戻せません。</Text>
              </ConfirmDialog>
            )}
          </Box>
        )}
      </aside>
      {aiDrawer.mounted && (
        <aside className="ai-drawer" data-leaving={aiDrawer.leaving || undefined}>
          <AiPanel
            post={context()}
            isPost={type === "post"}
            onApplyBody={applyBody}
            onApplyExcerpt={(excerpt) => update({ excerpt })}
            onApplyTitle={(title) => update({ title })}
            onApplySlug={(slug) => update({ slug })}
            onAddCategories={addCategories}
            onAddTags={addTags}
            onClose={() => setAiOpen(false)}
          />
        </aside>
      )}
      {draftOpen && (
        <DraftDialog
          onClose={() => setDraftOpen(false)}
          onDone={async (d) => {
            setDraftOpen(false);
            setSource(false);
            update({ title: d.title, slug: d.slug, excerpt: d.excerpt, body: d.body, body_format: "markdown" });
            setEditorKey((k) => k + 1);
            if (type === "post") await addTags(d.tags);
          }}
        />
      )}
    </div>
  );
}

/** A titled group in the editor sidebar. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Stack gap="md" component="section" className="side-section">
      <Text size="sm" fw={700}>
        {title}
      </Text>
      {children}
    </Stack>
  );
}

/** A field label with the ✨ button at its right end. */
function LabelWithAi({ label, ai }: { label: string; ai: React.ReactNode }) {
  return (
    <Group component="span" justify="space-between" wrap="nowrap" gap={4} style={{ width: "100%" }}>
      {label}
      {ai}
    </Group>
  );
}

type PermalinkProps = {
  /** Site URL without the trailing slash; empty when not set. */
  base: string;
  path: string;
  slug: string;
  published: boolean;
  onSlug: (slug: string) => void;
  ai: React.ReactNode;
};

/** The post's URL under the title, with its slug editable in place. */
function PermalinkBar({ base, path, slug, published, onSlug, ai }: PermalinkProps) {
  const [editing, setEditing] = useState(!slug);
  // Show the slug part of the path in bold.
  const at = slug ? path.lastIndexOf(slug) : path.lastIndexOf("…");
  const len = slug ? slug.length : 1;
  const [before, part, after] = at < 0 ? [path, "", ""] : [path.slice(0, at), path.slice(at, at + len), path.slice(at + len)];

  return (
    <Input.Wrapper
      label={
        <Group component="span" gap={6}>
          URL
          {!published && (
            <Badge variant="light" color="gray" size="sm" tt="none">
              未公開（公開するとこの URL になります）
            </Badge>
          )}
        </Group>
      }
    >
      <Group gap={8} wrap="nowrap" className="permalink">
        {editing ? (
          <>
            <Text size="sm" c="dimmed" className="permalink-text" style={{ flexShrink: 1 }}>
              {base}
              {before}
            </Text>
            <TextInput
              size="xs"
              value={slug}
              placeholder="例: hello-world"
              spellCheck={false}
              autoFocus={!!slug}
              onChange={(e) => onSlug(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && slug && setEditing(false)}
              w={240}
              aria-label="スラッグ"
            />
            <Text size="sm" c="dimmed">
              {after}
            </Text>
            {ai}
            <Button size="xs" ml="auto" leftSection={<Check size={14} />} disabled={!slug} onClick={() => setEditing(false)}>
              確定
            </Button>
          </>
        ) : (
          <>
            <Text size="sm" className="permalink-text">
              <span className="dim">
                {base}
                {before}
              </span>
              <strong>{part}</strong>
              <span className="dim">{after}</span>
            </Text>
            <Group gap={6} wrap="nowrap" ml="auto">
              {published && base && (
                <Tooltip label="「サイトに公開」した後の内容が表示されます">
                  <Button
                    size="xs"
                    variant="subtle"
                    color="gray"
                    leftSection={<ExternalLink size={14} />}
                    onClick={() => openUrl(`${base}${path}`)}
                  >
                    サイトで開く
                  </Button>
                </Tooltip>
              )}
              <Button size="xs" leftSection={<Pencil size={14} />} onClick={() => setEditing(true)}>
                スラッグを変更
              </Button>
            </Group>
          </>
        )}
      </Group>
    </Input.Wrapper>
  );
}
