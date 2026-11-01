import { useEffect, useState } from "react";
import { useMediaQuery } from "@mantine/hooks";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  Modifier,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { ArrowLeft, Database, ExternalLink, Eye, FilePlus, GripVertical, Inbox as InboxIcon, Mail, MailOpen, Plus, Send, ShieldCheck, Trash2 } from "lucide-react";
import { Flow } from "./ui/Flow";
import { GuideImage } from "./ui/GuideImage";
import turnstileTokenImage from "./assets/guide/cloudflare-token-turnstile.png";
import {
  FIELD_TYPES,
  FIELD_TYPE_GROUPS,
  FORMS_PERMISSION,
  Form,
  FormField,
  FormInput,
  Submission,
  defaultFields,
  hasOptions,
  deleteForm,
  deleteSubmission,
  disableForms,
  enableForms,
  formsStatus,
  listForms,
  listSubmissions,
  newFieldId,
  saveForm,
  setSubmissionRead,
} from "./lib/forms";
import { TOKEN_PAGE } from "./lib/auth";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Code,
  Drawer,
  Group,
  Input,
  Paper,
  Radio,
  Select,
  Stack,
  Table,
  TagsInput,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { Alert } from "./ui/Alert";
import { toast } from "./ui/Toast";
import { Card } from "./ui/Card";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { Menu } from "./ui/Menu";
import { PageHeader } from "./ui/PageHeader";

type Props = {
  /** Opens a new page that shows the form. */
  onCreatePage: (formId: number) => void;
  onOpenPage: (id: number) => void;
  /** Read state changed (for the sidebar's unread count). */
  onInboxChange: () => void;
  /** The form being edited has unsaved changes (guards leaving the screen). */
  onDirtyChange: (dirty: boolean) => void;
};

/** Contact forms: defining them and reading submissions (turned on in the site info screen). */
export function Forms(props: Props) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    formsStatus()
      .then((s) => setEnabled(s.enabled))
      .catch((err) => setError(String(err)));
  }, []);

  return (
    <div className="setup setup-wide">
      {error && <Alert level="error">{error}</Alert>}
      {enabled === false && (
        <>
          <PageHeader title="問い合わせフォーム" />
          <Alert level="info">問い合わせフォームは無効です。「サイト情報」の「問い合わせフォーム」で有効にできます。</Alert>
        </>
      )}
      {enabled && <FormsHome {...props} />}
    </div>
  );
}

/**
 * Turning contact forms on and off, for the site info screen. Turning them
 * on creates the site's Turnstile widget and needs a token permission.
 */
export function FormsFeatureCard({ onChange }: { onChange: (enabled: boolean) => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    formsStatus()
      .then((s) => setEnabled(s.enabled))
      .catch((err) => setError(String(err)));
  }, []);

  const enable = async () => {
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      if ((await enableForms()) === "permission") {
        // Pressed again from the notice: say that it is still missing.
        if (needsPermission) {
          toast("まだ権限が足りません", { level: "error", description: `${FORMS_PERMISSION} を追加して保存したか確認してください` });
        }
        setNeedsPermission(true);
      } else {
        setNeedsPermission(false);
        setEnabled(true);
        onChange(true);
        toast("問い合わせフォームを有効にしました");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="問い合わせフォーム" actions={enabled && <Badge variant="light">有効</Badge>}>
      <Text size="sm" c="dimmed">
        固定ページの下に問い合わせフォームを置けます（固定ページの編集画面で選びます）。
      </Text>
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          送信された内容の流れ
        </Text>
        <Flow
          steps={[
            { icon: <Send size={22} />, title: "閲覧者が送信", sub: "公開サイトのフォーム" },
            { icon: <ShieldCheck size={22} />, title: "ボットを確認", sub: "Cloudflare Turnstile" },
            { icon: <Database size={22} />, title: "D1 に保存", sub: "このサイトのデータベース", accent: true },
            { icon: <InboxIcon size={22} />, title: "アプリで読む", sub: "「問い合わせ」画面" },
          ]}
        />
        <Text size="xs" c="dimmed">
          送信された内容は、あなたの Cloudflare アカウントにあるこのサイトの D1 データベースにだけ保存され、ほかのサービスには送られません。メールでは届かないので、アプリで確認します（アプリの起動中は 5 分ごとに確認し、新着があれば通知します）。
        </Text>
      </Stack>
      {enabled === false && !needsPermission && (
        <Group gap="sm">
          <Button variant="filled" loading={busy} onClick={enable}>
            有効にする
          </Button>
          <Text size="xs" c="dimmed">
            このサイト用の Turnstile ウィジェットを作ります。フォームがサイトに出るのは次の公開からです。
          </Text>
        </Group>
      )}
      {needsPermission && (
        <Alert
          level="warning"
          title="Cloudflare のユーザー API トークンに権限を追加してください"
          actions={
            <>
              <Button size="xs" leftSection={<ExternalLink size={14} />} onClick={() => openUrl(TOKEN_PAGE)}>
                Cloudflare の API トークンの管理画面を開く
              </Button>
              <Button size="xs" variant="filled" loading={busy} onClick={enable}>
                もう一度試す
              </Button>
            </>
          }
        >
          <ol className="steps">
            <li>
              Cloudflare の API トークンの管理画面（<Code>{TOKEN_PAGE}</Code>）で、このアプリに登録したトークンの「Edit」を開きます
            </li>
            <li>
              次の権限を追加して保存します
              <div>
                <Code>{FORMS_PERMISSION}</Code>（日本語の画面では「アカウント / Turnstile / 編集」）
              </div>
              <GuideImage src={turnstileTokenImage} alt="Cloudflare の API トークンの編集画面" />
            </li>
            <li>「もう一度試す」を押します</li>
          </ol>
          <p>GitHub Actions から公開している場合は、そちらのトークンにも同じ権限が必要です。</p>
        </Alert>
      )}
      {enabled && (
        <Group gap="sm">
          <Button variant="subtle" color="red" onClick={() => setConfirmDisable(true)}>
            無効にする
          </Button>
          <Text size="xs" c="dimmed">
            フォームの設定と受信した内容は残ります。
          </Text>
        </Group>
      )}
      {warning && (
        <Alert level="warning" onClose={() => setWarning(null)}>
          <p>{warning}</p>
        </Alert>
      )}
      {error && <Alert level="error">{error}</Alert>}
      {confirmDisable && (
        <ConfirmDialog
          title="問い合わせフォームを無効にしますか？"
          confirmLabel="無効にする"
          danger
          onConfirm={async () => {
            setWarning(await disableForms());
            setEnabled(false);
            onChange(false);
            toast("問い合わせフォームを無効にしました");
          }}
          onClose={() => setConfirmDisable(false)}
        >
          <Text size="sm">
            次に公開したときから、サイトのフォームが消え、送信も受け付けなくなります。フォームの設定と受信した内容は残り、後でまた有効にできます。
          </Text>
          <Text size="sm">このサイト用の Turnstile ウィジェットは Cloudflare から削除します。</Text>
        </ConfirmDialog>
      )}
    </Card>
  );
}

type Selected = { id: number | null; tab: "inbox" | "edit" } | null;

function FormsHome({ onCreatePage, onOpenPage, onInboxChange, onDirtyChange }: Props) {
  const [forms, setForms] = useState<Form[] | null>(null);
  const [selected, setSelected] = useState<Selected>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    listForms()
      .then(setForms)
      .catch((err) => setError(String(err)));

  useEffect(() => {
    load();
  }, []);

  const back = () => {
    setSelected(null);
    load();
    onInboxChange();
  };

  if (selected) {
    const form = forms?.find((f) => f.id === selected.id) ?? null;
    return (
      <FormDetail
        key={selected.id ?? "new"}
        form={form}
        tab={selected.id === null ? "edit" : selected.tab}
        onTab={(tab) => setSelected({ ...selected, tab })}
        onBack={back}
        onSaved={async (id) => {
          await load();
          setSelected({ id, tab: "edit" });
        }}
        onDeleted={back}
        onDirtyChange={onDirtyChange}
        onCreatePage={onCreatePage}
        onOpenPage={onOpenPage}
        onInboxChange={() => {
          load();
          onInboxChange();
        }}
      />
    );
  }

  return (
    <>
      <PageHeader title="問い合わせフォーム">
        <Button variant="filled" leftSection={<Plus size={16} />} onClick={() => setSelected({ id: null, tab: "edit" })}>
          フォームを追加
        </Button>
      </PageHeader>
      {error && <Alert level="error">{error}</Alert>}
      {forms === null && !error && <Text c="dimmed">読み込み中…</Text>}
      {forms?.length === 0 && (
        <Paper withBorder radius="md" p="xl">
          <Text size="sm" c="dimmed" ta="center">
            フォームはまだありません。「フォームを追加」から作り、固定ページで表示するフォームに選びます。
          </Text>
        </Paper>
      )}
      {forms && forms.length > 0 && (
        <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
          <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>名前</Table.Th>
                <Table.Th>表示するページ</Table.Th>
                <Table.Th w={160}>受信</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {forms.map((f) => (
                <Table.Tr key={f.id} onClick={() => setSelected({ id: f.id, tab: "inbox" })} style={{ cursor: "pointer" }}>
                  <Table.Td>
                    <Text size="sm" fw={600}>
                      {f.name}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {f.pages.length ? f.pages.map((p) => p.title).join("、") : "なし"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      <Text size="sm">{f.submissions} 件</Text>
                      {f.unread > 0 && <Badge size="sm">未読 {f.unread}</Badge>}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
    </>
  );
}

type DetailProps = {
  form: Form | null;
  tab: "inbox" | "edit";
  onTab: (tab: "inbox" | "edit") => void;
  onBack: () => void;
  onSaved: (id: number) => void;
  onDeleted: () => void;
  onCreatePage: (formId: number) => void;
  onOpenPage: (id: number) => void;
  onInboxChange: () => void;
  onDirtyChange: (dirty: boolean) => void;
};

function FormDetail({
  form,
  tab,
  onTab,
  onBack,
  onSaved,
  onDeleted,
  onCreatePage,
  onOpenPage,
  onInboxChange,
  onDirtyChange,
}: DetailProps) {
  const [dirty, setDirty] = useState(false);
  /** Leaving with unsaved changes waits for the user's answer. */
  const [pending, setPending] = useState<(() => void) | null>(null);
  const guard = (go: () => void) => (dirty ? setPending(() => go) : go());
  useEffect(() => onDirtyChange(dirty), [dirty]);
  useEffect(() => () => onDirtyChange(false), []);

  return (
    <>
      {pending && (
        <ConfirmDialog
          title="保存していない変更があります"
          confirmLabel="変更を破棄して移動"
          cancelLabel="編集に戻る"
          danger
          onConfirm={() => {
            const go = pending;
            setDirty(false);
            go();
          }}
          onClose={() => setPending(null)}
        >
          <Text size="sm">このまま移動すると、フォームの設定の変更は失われます。</Text>
        </ConfirmDialog>
      )}
      <Group gap="xs" wrap="nowrap" className="page-header">
        <ActionIcon variant="subtle" color="gray" size="lg" title="一覧に戻る" aria-label="一覧に戻る" onClick={() => guard(onBack)}>
          <ArrowLeft size={18} />
        </ActionIcon>
        <Title order={1} size="h3">
          {form?.name ?? "新しいフォーム"}
        </Title>
      </Group>
      {form && (
        <Tabs value={tab} onChange={(v) => v && guard(() => onTab(v as "inbox" | "edit"))}>
          <Tabs.List>
            <Tabs.Tab value="inbox" rightSection={form.unread > 0 ? <Badge size="sm">{form.unread}</Badge> : undefined}>
              受信一覧
            </Tabs.Tab>
            <Tabs.Tab value="edit">フォームの設定</Tabs.Tab>
          </Tabs.List>
        </Tabs>
      )}
      {form && tab === "inbox" && <Inbox form={form} onChange={onInboxChange} />}
      {tab === "edit" && (
        <>
          {form && (
            <Card
              title="表示するページ"
              description={
                form.pages.length === 0
                  ? "まだどの固定ページにも表示されていません。固定ページの編集画面の「問い合わせフォーム」で選ぶか、ここから作ります。"
                  : "このフォームを表示している固定ページです。"
              }
            >
              <Group gap="xs">
                {form.pages.map((p) => (
                  <Button key={p.id} size="xs" variant="light" onClick={() => onOpenPage(p.id)}>
                    {p.title}
                  </Button>
                ))}
                <Button size="xs" leftSection={<FilePlus size={14} />} onClick={() => onCreatePage(form.id)}>
                  このフォームの固定ページを作る
                </Button>
              </Group>
            </Card>
          )}
          <FormEditor form={form} onSaved={onSaved} onDeleted={onDeleted} onDirtyChange={setDirty} />
        </>
      )}
    </>
  );
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function Inbox({ form, onChange }: { form: Form; onChange: () => void }) {
  const [items, setItems] = useState<Submission[] | null>(null);
  const [deleting, setDeleting] = useState<Submission | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    listSubmissions(form.id)
      .then(setItems)
      .catch((err) => setError(String(err)));

  useEffect(() => {
    load();
  }, [form.id]);

  const toggleRead = async (s: Submission) => {
    setError(null);
    try {
      await setSubmissionRead(s.id, s.read_at === null);
      await load();
      onChange();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <>
      <Text size="sm" c="dimmed">
        新しい順に最大 200 件を表示します。送信された内容には個人情報が含まれます。不要になったものは削除してください。
      </Text>
      {error && <Alert level="error">{error}</Alert>}
      {items === null && !error && <Text c="dimmed">読み込み中…</Text>}
      {items?.length === 0 && (
        <Paper withBorder radius="md" p="xl">
          <Text size="sm" c="dimmed" ta="center">
            まだ届いていません。
          </Text>
        </Paper>
      )}
      {items?.map((s) => (
        <Paper key={s.id} withBorder radius="md" p="md" className={s.read_at === null ? "submission unread" : "submission"}>
          <Stack gap="sm">
            <Group gap="xs" wrap="nowrap">
              {s.read_at === null && <Badge size="sm">未読</Badge>}
              <Text size="sm" c="dimmed">
                {fmtDate(s.created_at)}
                {s.page_path && `（${s.page_path}）`}
              </Text>
              <Group gap={4} ml="auto" wrap="nowrap">
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  leftSection={s.read_at === null ? <MailOpen size={14} /> : <Mail size={14} />}
                  onClick={() => toggleRead(s)}
                >
                  {s.read_at === null ? "既読にする" : "未読に戻す"}
                </Button>
                <ActionIcon variant="subtle" color="red" title="削除" aria-label="削除" onClick={() => setDeleting(s)}>
                  <Trash2 size={16} />
                </ActionIcon>
              </Group>
            </Group>
            <dl className="submission-data selectable">
              {(s.data ?? []).map((d, i) => (
                <div key={i}>
                  <dt>{d.label}</dt>
                  <dd>{d.value === "on" ? "チェックあり" : d.value || <span className="dim">（空欄）</span>}</dd>
                </div>
              ))}
            </dl>
          </Stack>
        </Paper>
      ))}
      {deleting && (
        <ConfirmDialog
          title="この問い合わせを削除しますか？"
          confirmLabel="削除する"
          danger
          onConfirm={async () => {
            await deleteSubmission(deleting.id);
            await load();
            onChange();
          }}
          onClose={() => setDeleting(null)}
        >
          <Text size="sm">{fmtDate(deleting.created_at)} に届いた内容を削除します。元に戻せません。</Text>
        </ConfirmDialog>
      )}
    </>
  );
}

const emptyInput = (): FormInput => ({
  id: null,
  name: "お問い合わせ",
  fields: defaultFields(),
  submit_label: null,
  success_message: null,
});

type EditorProps = {
  form: Form | null;
  onSaved: (id: number) => void;
  onDeleted: () => void;
  onDirtyChange: (dirty: boolean) => void;
};

function FormEditor({ form, onSaved, onDeleted, onDirtyChange }: EditorProps) {
  const [input, setInput] = useState<FormInput>(() =>
    form
      ? {
          id: form.id,
          name: form.name,
          fields: form.fields,
          submit_label: form.submit_label,
          success_message: form.success_message,
        }
      : emptyInput(),
  );
  /** As loaded or saved; "unsaved" means the input differs from it. */
  const [baseline, setBaseline] = useState(() => JSON.stringify(input));
  useEffect(() => onDirtyChange(JSON.stringify(input) !== baseline), [input, baseline]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Below this width the preview moves from the side column to a drawer.
  const narrow = useMediaQuery("(max-width: 1500px)");
  const [previewOpen, setPreviewOpen] = useState(false);

  const setField = (i: number, patch: Partial<FormField>) =>
    setInput({ ...input, fields: input.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = input.fields.findIndex((f) => f.id === active.id);
    const to = input.fields.findIndex((f) => f.id === over.id);
    setInput({ ...input, fields: arrayMove(input.fields, from, to) });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const saved = {
        ...input,
        fields: input.fields.map((f) => (f.options ? { ...f, options: f.options.map((o) => o.trim()).filter(Boolean) } : f)),
      };
      const id = await saveForm(saved);
      setInput(saved);
      setBaseline(JSON.stringify(saved));
      toast("フォームを保存しました。サイトへの反映は次の公開からです");
      onSaved(id);
    } catch (err) {
      setMessage({ error: true, text: String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form-builder">
      <Card
        title={form ? "フォームの設定" : "新しいフォーム"}
        actions={
          narrow && (
            <Button size="xs" variant="default" leftSection={<Eye size={14} />} onClick={() => setPreviewOpen(true)}>
              プレビュー
            </Button>
          )
        }
        onSubmit={save}
      >
        <TextInput
          label="フォームの名前"
          description="管理用の名前です。サイトには表示されません。"
          value={input.name}
          onChange={(e) => setInput({ ...input, name: e.target.value })}
        />
        <Input.Wrapper label="項目" description="上から順にフォームに並びます。左端のつまみをドラッグして並べ替えられます。">
          <Stack gap="xs" mt={6}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVertical]} onDragEnd={onDragEnd}>
              <SortableContext items={input.fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                {input.fields.map((f, i) => (
                  <SortableField
                    key={f.id}
                    field={f}
                    onChange={(patch) => setField(i, patch)}
                    onRemove={() => setInput({ ...input, fields: input.fields.filter((_, j) => j !== i) })}
                  />
                ))}
              </SortableContext>
            </DndContext>
            <div>
              <Button
                size="xs"
                leftSection={<Plus size={14} />}
                onClick={() =>
                  setInput({
                    ...input,
                    fields: [...input.fields, { id: newFieldId(), label: "", type: "text", required: false }],
                  })
                }
              >
                項目を追加
              </Button>
            </div>
          </Stack>
        </Input.Wrapper>
        <TextInput
          label="送信ボタンの文字"
          value={input.submit_label ?? ""}
          placeholder="送信する"
          onChange={(e) => setInput({ ...input, submit_label: e.target.value })}
        />
        <Textarea
          label="送信後に表示するメッセージ"
          autosize
          minRows={2}
          value={input.success_message ?? ""}
          placeholder="送信しました。お問い合わせありがとうございます。"
          onChange={(e) => setInput({ ...input, success_message: e.target.value })}
        />
        <Alert level="info">
          項目を変えたら、サイトに公開し直してください。公開中のページと項目が食い違うと、必須の項目が足りないとして送信できないことがあります。
        </Alert>
        {message &&
          (message.error ? (
            <Alert level="error">{message.text}</Alert>
          ) : (
            <Text size="sm" c="dimmed">
              {message.text}
            </Text>
          ))}
        <Group gap="sm">
          <Button type="submit" variant="filled" loading={busy}>
            保存
          </Button>
          {form && (
            <Button
              variant="subtle"
              color="red"
              ml="auto"
              leftSection={<Trash2 size={16} />}
              onClick={() => setConfirmDelete(true)}
            >
              フォームを削除
            </Button>
          )}
        </Group>
        {confirmDelete && form && (
          <ConfirmDialog
            title="フォームを削除しますか？"
            confirmLabel="削除する"
            danger
            onConfirm={async () => {
              await deleteForm(form.id);
              onDeleted();
            }}
            onClose={() => setConfirmDelete(false)}
          >
            <Text size="sm">受信した {form.submissions} 件の内容も削除されます。元に戻せません。</Text>
            {form.pages.length > 0 && (
              <Text size="sm">表示していたページ（{form.pages.map((p) => p.title).join("、")}）からはフォームが外れます。</Text>
            )}
          </ConfirmDialog>
        )}
      </Card>
      {narrow ? (
        <Drawer opened={previewOpen} onClose={() => setPreviewOpen(false)} position="right" size={440} title="プレビュー">
          <Text size="xs" c="dimmed" mb="sm">
            {PREVIEW_NOTE}
          </Text>
          <FormPreview input={input} />
        </Drawer>
      ) : (
        <div className="form-builder-preview">
          <Card title="プレビュー" description={PREVIEW_NOTE}>
            <FormPreview input={input} />
          </Card>
        </div>
      )}
    </div>
  );
}

/** Keeps dragging on the vertical axis. */
const restrictToVertical: Modifier = ({ transform }) => ({ ...transform, x: 0 });

type FieldProps = {
  field: FormField;
  onChange: (patch: Partial<FormField>) => void;
  onRemove: () => void;
};

/** One field of the form editor, draggable by its handle. */
function SortableField({ field: f, onChange, onRemove }: FieldProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: f.id });
  return (
    <Paper
      ref={setNodeRef}
      withBorder
      radius="md"
      p="xs"
      bg="var(--surface-2)"
      className={isDragging ? "form-field dragging" : "form-field"}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <Stack gap="xs">
        <Group gap="xs" wrap="nowrap">
          <ActionIcon
            ref={setActivatorNodeRef}
            variant="subtle"
            color="gray"
            className="drag-handle"
            aria-label="ドラッグして並べ替え"
            title="ドラッグして並べ替え"
            {...attributes}
            {...listeners}
          >
            <GripVertical size={16} />
          </ActionIcon>
          <TextInput
            flex={1}
            value={f.label}
            placeholder="項目の名前（例: お名前）"
            aria-label="項目の名前"
            onChange={(e) => onChange({ label: e.target.value })}
          />
          <Box w={250}>
            <Menu
              label={FIELD_TYPES.find((t) => t.type === f.type)?.label ?? f.type}
              items={FIELD_TYPE_GROUPS.flatMap((g, gi) => [
                ...(gi > 0 ? [{ kind: "separator" as const, key: `sep-${g.label}` }] : []),
                { kind: "heading" as const, key: `h-${g.label}`, label: g.label },
                ...g.types.map((t) => ({
                  key: t.type,
                  label: t.label,
                  checked: t.type === f.type,
                  onSelect: () =>
                    onChange({
                      type: t.type,
                      // Keep the choices when switching between choice types.
                      options: hasOptions(t.type) ? (f.options?.length ? f.options : ["選択肢 1", "選択肢 2"]) : undefined,
                    }),
                })),
              ])}
            />
          </Box>
          <Checkbox label="必須" checked={f.required} onChange={(e) => onChange({ required: e.currentTarget.checked })} />
          <ActionIcon variant="subtle" color="red" title="項目を削除" aria-label="項目を削除" onClick={onRemove}>
            <Trash2 size={16} />
          </ActionIcon>
        </Group>
        {hasOptions(f.type) && (
          <TagsInput
            label="選択肢"
            description="入力して Enter で追加します。× で削除できます。"
            size="xs"
            ml={34}
            value={f.options ?? []}
            onChange={(options) => onChange({ options })}
            placeholder="選択肢を追加"
          />
        )}
      </Stack>
    </Paper>
  );
}

const PREVIEW_NOTE = "入力中のフォームの見え方の目安です。ここでは入力できません。実際の見た目はサイトのテーマによります。";

/**
 * A rough look at the form as it is being built. The site's theme decides
 * the real look. It is inert, so it doesn't read as a form to fill in.
 */
function FormPreview({ input }: { input: FormInput }) {
  // Fields slide to their new place when reordered.
  const [animated] = useAutoAnimate<HTMLDivElement>({ duration: 220 });
  const label = (f: FormField) => f.label || "（名前のない項目）";
  const options = (f: FormField) => (f.options ?? []).map((o) => o.trim()).filter(Boolean);
  return (
    <div className="form-preview-frame" inert>
      <Stack gap="md" className="form-preview" ref={animated}>
        {input.fields.map((f) => {
          const common = { label: label(f), withAsterisk: f.required };
          switch (f.type) {
            case "textarea":
              return <Textarea key={f.id} {...common} autosize minRows={4} />;
            case "select":
              return (
                <Select
                  key={f.id}
                  {...common}
                  data={[...new Set(options(f))]}
                  placeholder="選択してください"
                  comboboxProps={{ withinPortal: true }}
                />
              );
            case "radio":
              return (
                <Radio.Group key={f.id} {...common}>
                  <Stack gap={6} mt={4}>
                    {[...new Set(options(f))].map((o) => (
                      <Radio key={o} value={o} label={o} />
                    ))}
                  </Stack>
                </Radio.Group>
              );
            case "checkboxes":
              return (
                <Checkbox.Group key={f.id} {...common}>
                  <Stack gap={6} mt={4}>
                    {[...new Set(options(f))].map((o) => (
                      <Checkbox key={o} value={o} label={o} />
                    ))}
                  </Stack>
                </Checkbox.Group>
              );
            case "checkbox":
              return <Checkbox key={f.id} label={`${label(f)}${f.required ? " *" : ""}`} />;
            default:
              return <TextInput key={f.id} {...common} type={f.type} />;
          }
        })}
        <Paper withBorder radius="sm" p="xs" w={300} bg="var(--surface-2)">
          <Text size="xs" c="dimmed">
            ここに不正送信を防ぐ確認（Cloudflare Turnstile）が表示されます
          </Text>
        </Paper>
        <div>
          <Button variant="filled">{input.submit_label?.trim() || "送信する"}</Button>
        </div>
      </Stack>
    </div>
  );
}
