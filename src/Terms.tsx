import { useEffect, useMemo, useState } from "react";
import {
  Category,
  Tag,
  TermInput,
  categoryTree,
  deleteAuthor,
  deleteCategory,
  deleteTag,
  listAuthors,
  listCategories,
  listTags,
  saveAuthor,
  saveCategory,
  saveTag,
  suggestSlug,
} from "./lib/taxonomy";
import { Eraser, Plus, Trash2 } from "lucide-react";
import { Box, Button, Checkbox, Group, Input, Modal, Paper, Stack, Table, Text, TextInput, Textarea, Title } from "@mantine/core";
import { Alert } from "./ui/Alert";
import { toast } from "./ui/Toast";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { Menu } from "./ui/Menu";
import { PageHeader } from "./ui/PageHeader";
import { MessageText } from "./ui/CopyButton";
import { createReadingTracker } from "./lib/reading";

const empty: TermInput = { id: null, slug: "", name: "", description: null, parent_id: null, sort_order: 0 };

export function Terms() {
  return (
    <Stack gap={4}>
      <PageHeader title="カテゴリー・タグ" />
      <div className="terms">
        <TermPanel kind="category" />
        <TermPanel kind="tag" />
      </div>
    </Stack>
  );
}

type Kind = "category" | "tag" | "author";

const API = {
  category: { label: "カテゴリー", list: listCategories, save: saveCategory, remove: deleteCategory },
  tag: { label: "タグ", list: listTags, save: saveTag, remove: deleteTag },
  author: { label: "著者", list: listAuthors, save: saveAuthor, remove: deleteAuthor },
};

/** Also used for authors on the site info screen. */
export function TermPanel({ kind }: { kind: Kind }) {
  const { label } = API[kind];
  const [items, setItems] = useState<(Category | Tag)[] | null>(null);
  const [form, setForm] = useState<TermInput | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  // Japanese typed into the name becomes a romaji slug (旅行 → ryokou).
  const formKey = form === null ? null : (form.id ?? "new");
  const reading = useMemo(() => createReadingTracker(), [formKey]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tidying up: unused terms picked to delete together (null when not tidying).
  const [picked, setPicked] = useState<Set<number> | null>(null);
  const [confirmTidy, setConfirmTidy] = useState(false);

  const load = () =>
    API[kind]
      .list()
      .then(setItems)
      .catch((err) => setError(String(err)));

  useEffect(() => {
    load();
  }, [kind]);

  const categories = kind === "category" ? (items as Category[] | null) : null;
  const rows =
    categories !== null
      ? categoryTree(categories ?? [])
      : (items ?? []).map((t) => ({ category: t as Category, depth: 0 }));
  // A category with children stays, even with no posts of its own.
  const unused = new Set(
    (items ?? [])
      .filter((t) => t.post_count === 0 && !categories?.some((c) => c.parent_id === t.id))
      .map((t) => t.id),
  );
  const pickedNames = (items ?? []).filter((t) => picked?.has(t.id)).map((t) => t.name);

  const togglePick = (id: number) =>
    setPicked((p) => {
      const next = new Set(p);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  /** Errors are left to the confirmation dialog to show. */
  const removePicked = async () => {
    if (!picked) return;
    try {
      for (const id of picked) await API[kind].remove(id);
    } finally {
      // Shows what is left if one of them failed.
      await load();
    }
    toast(`未使用の${label}を ${picked.size} 件削除しました`);
    setPicked(null);
  };

  const edit = (item: Category | Tag | null) => {
    setError(null);
    setConfirmDelete(false);
    setSlugTouched(item !== null);
    setForm(item ? { ...empty, ...item } : { ...empty });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      await API[kind].save(form);
      toast(`${label}「${form.name}」を保存しました`);
      setForm(null);
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  /** Errors are left to the confirmation dialog to show. */
  const remove = async () => {
    if (!form?.id) return;
    await API[kind].remove(form.id);
    toast(`${label}「${form.name}」を削除しました`);
    setForm(null);
    await load();
  };

  return (
    <Stack component="section" className="term-panel" gap="sm">
      <Group justify="space-between" wrap="nowrap">
        <Title order={2} size="h4">
          {label}
        </Title>
        {picked ? (
          <Group gap="xs" wrap="nowrap">
            <Button size="sm" onClick={() => setPicked(null)}>
              やめる
            </Button>
            <Button
              size="sm"
              variant="filled"
              color="red"
              leftSection={<Trash2 size={16} />}
              disabled={picked.size === 0}
              onClick={() => setConfirmTidy(true)}
            >
              {picked.size} 件を削除
            </Button>
          </Group>
        ) : (
          <Group gap="xs" wrap="nowrap">
            {kind !== "author" && unused.size > 0 && (
              <Button size="sm" variant="subtle" color="gray" leftSection={<Eraser size={16} />} onClick={() => setPicked(new Set())}>
                未使用を整理
              </Button>
            )}
            <Button size="sm" leftSection={<Plus size={16} />} onClick={() => edit(null)}>
              追加
            </Button>
          </Group>
        )}
      </Group>
      {picked && (
        <Text size="sm" c="dimmed">
          記事で使われていない{label}を選んで、まとめて削除できます。
          {categories && "子カテゴリーを持つカテゴリーは選べません。"}
        </Text>
      )}
      {kind === "author" && (
        <Text size="sm" c="dimmed">
          記事に著者を設定すると、記事に名前とプロフィールが表示され、著者ごとの記事一覧（/author/スラッグ/）ができます。一人で書くサイトなら設定しなくても構いません。
        </Text>
      )}
      {!form && error && <Alert level="error">{error}</Alert>}
      {items === null && !error && <Text c="dimmed">読み込み中…</Text>}
      {items?.length === 0 && (
        <Paper withBorder p="lg" radius="md">
          <Text size="sm" c="dimmed" ta="center">
            {label}はまだありません。
          </Text>
        </Paper>
      )}
      {rows.length > 0 && (
        <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
          <Table highlightOnHover verticalSpacing="xs" horizontalSpacing="md">
            <Table.Thead>
              <Table.Tr>
                {picked && (
                  <Table.Th w={40}>
                    <Checkbox
                      size="xs"
                      aria-label="未使用をすべて選ぶ"
                      checked={picked.size > 0 && picked.size === unused.size}
                      indeterminate={picked.size > 0 && picked.size < unused.size}
                      onChange={() => setPicked(picked.size === unused.size ? new Set() : new Set(unused))}
                    />
                  </Table.Th>
                )}
                <Table.Th>名前</Table.Th>
                <Table.Th>スラッグ</Table.Th>
                <Table.Th w={90} ta="right" style={{ whiteSpace: "nowrap" }}>
                  記事数
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map(({ category: item, depth }) => (
                <Table.Tr
                  key={item.id}
                  onClick={() => (picked ? unused.has(item.id) && togglePick(item.id) : edit(item))}
                  style={{ cursor: picked && !unused.has(item.id) ? "default" : "pointer", opacity: picked && !unused.has(item.id) ? 0.5 : undefined }}
                >
                  {picked && (
                    <Table.Td>
                      {unused.has(item.id) && (
                        <Checkbox
                          size="xs"
                          aria-label={`${item.name}を選ぶ`}
                          checked={picked.has(item.id)}
                          onChange={() => togglePick(item.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                    </Table.Td>
                  )}
                  <Table.Td style={{ paddingLeft: 16 + depth * 20 }}>
                    <Text size="sm" fw={500}>
                      {depth > 0 && <span className="dim">└ </span>}
                      {item.name}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {item.slug}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm">{item.post_count}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}

      <Modal
        opened={form !== null}
        onClose={() => !busy && setForm(null)}
        title={<Text fw={600}>{form?.id ? `${label}を編集` : `${label}を追加`}</Text>}
        size="md"
      >
        {form && (
          <form onSubmit={submit}>
            <Stack gap="md">
              <TextInput
                label="名前"
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.target.value, slug: slugTouched ? form.slug : suggestSlug(e.target.value, reading) })
                }
                onCompositionUpdate={reading.onCompositionUpdate}
                onCompositionEnd={(e) => {
                  reading.onCompositionEnd(e);
                  // The input event comes before compositionend, so suggest again with the reading.
                  if (!slugTouched) setForm((f) => f && { ...f, slug: suggestSlug(f.name, reading) });
                }}
                data-autofocus
              />
              <TextInput
                label="スラッグ"
                description="URL に使う英数字の名前です。"
                value={form.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setForm({ ...form, slug: e.target.value });
                }}
                spellCheck={false}
              />
              {categories && (
                <Input.Wrapper label="親カテゴリー">
                  <Box mt={6}>
                    <Menu
                      label={categories.find((c) => c.id === form.parent_id)?.name ?? "なし"}
                      items={[
                        { key: "none", label: "なし", checked: form.parent_id == null, onSelect: () => setForm({ ...form, parent_id: null }) },
                        ...categoryTree(categories)
                          .filter(({ category }) => category.id !== form.id)
                          .map(({ category, depth }) => ({
                            key: String(category.id),
                            label: <span style={{ paddingLeft: depth * 16 }}>{category.name}</span>,
                            checked: category.id === form.parent_id,
                            onSelect: () => setForm({ ...form, parent_id: category.id }),
                          })),
                      ]}
                    />
                  </Box>
                </Input.Wrapper>
              )}
              <Textarea
                label={kind === "author" ? "プロフィール" : "説明"}
                description={kind === "author" ? "記事の下に表示されます。" : "一覧ページに表示されます（テーマによります）。"}
                autosize
                minRows={2}
                value={form.description ?? ""}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
              {error && (
                <MessageText size="sm" error>
                  {error}
                </MessageText>
              )}
              <Group gap="sm">
                {form.id !== null && (
                  <Button variant="subtle" color="red" leftSection={<Trash2 size={16} />} disabled={busy} onClick={() => setConfirmDelete(true)}>
                    削除
                  </Button>
                )}
                <Group gap="sm" ml="auto">
                  <Button onClick={() => setForm(null)} disabled={busy}>
                    キャンセル
                  </Button>
                  <Button type="submit" variant="filled" loading={busy}>
                    保存
                  </Button>
                </Group>
              </Group>
            </Stack>
          </form>
        )}
      </Modal>
      {confirmDelete && form && (
        <ConfirmDialog
          title={`${label}を削除しますか？`}
          confirmLabel="削除する"
          danger
          onConfirm={remove}
          onClose={() => setConfirmDelete(false)}
        >
          <Text size="sm">
            {kind === "author" ? "この著者の記事は著者なしになります（記事自体は残ります）。" : "記事との関連付けも外れます（記事自体は残ります）。"}
          </Text>
          {categories && <Text size="sm">子カテゴリーは一つ上の階層に移ります。</Text>}
        </ConfirmDialog>
      )}
      {confirmTidy && picked && (
        <ConfirmDialog
          title={`${label}を ${picked.size} 件削除しますか？`}
          confirmLabel="削除する"
          danger
          onConfirm={removePicked}
          onClose={() => setConfirmTidy(false)}
        >
          <Text size="sm">
            {pickedNames.slice(0, 10).join("、")}
            {pickedNames.length > 10 && ` ほか ${pickedNames.length - 10} 件`}
          </Text>
        </ConfirmDialog>
      )}
    </Stack>
  );
}
