import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Redirect, RedirectInput, deleteRedirect, listRedirects, saveRedirect } from "./lib/redirects";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { Button, Code, Group, Modal, Paper, SegmentedControl, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { Alert } from "./ui/Alert";
import { toast } from "./ui/Toast";
import { MessageText } from "./ui/CopyButton";

const empty: RedirectInput = { id: null, from_path: "", to_path: "", status_code: 301 };
const CODES = { 301: "301（恒久的な移動）", 302: "302（一時的な移動）" } as const;

/** Redirects written to the published site's `_redirects`. */
export function Redirects() {
  const [items, setItems] = useState<Redirect[] | null>(null);
  const [form, setForm] = useState<RedirectInput | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    listRedirects()
      .then(setItems)
      .catch((err) => setError(String(err)));

  useEffect(() => {
    load();
  }, []);

  const edit = (item: Redirect | null) => {
    setError(null);
    setForm(item ? { ...item } : { ...empty });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      await saveRedirect(form);
      toast("リダイレクトを保存しました");
      setForm(null);
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack component="section" gap="sm">
      <Group justify="space-between" wrap="nowrap">
        <Title order={2} size="h4">
          リダイレクト
        </Title>
        <Button size="sm" leftSection={<Plus size={16} />} onClick={() => edit(null)}>
          追加
        </Button>
      </Group>
      <Text size="sm" c="dimmed">
        スラッグを変えた記事や、移転前のサイトの URL を、新しい URL に転送します。次の「サイトに公開」から反映されます。
      </Text>
      {!form && error && <Alert level="error">{error}</Alert>}
      {items?.length === 0 && (
        <Text size="sm" c="dimmed">
          リダイレクトはまだありません。
        </Text>
      )}
      {items && items.length > 0 && (
        <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
          <Table highlightOnHover verticalSpacing="xs" horizontalSpacing="md">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>転送元</Table.Th>
                <Table.Th>転送先</Table.Th>
                <Table.Th w={70}>種類</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((r) => (
                <Table.Tr key={r.id} onClick={() => edit(r)} style={{ cursor: "pointer" }}>
                  <Table.Td>
                    <Code>{r.from_path}</Code>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {r.to_path}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{r.status_code}</Text>
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
        title={<Text fw={600}>{form?.id ? "リダイレクトを編集" : "リダイレクトを追加"}</Text>}
      >
        {form && (
          <form onSubmit={submit}>
            <Stack gap="md">
              <TextInput
                label="転送元"
                description="/ から始まるパスです。? 以降（クエリ文字列）は使えません。"
                value={form.from_path}
                onChange={(e) => setForm({ ...form, from_path: e.target.value })}
                placeholder="例: /old-post/"
                spellCheck={false}
                data-autofocus
              />
              <TextInput
                label="転送先"
                value={form.to_path}
                onChange={(e) => setForm({ ...form, to_path: e.target.value })}
                placeholder="例: /posts/new-post/ または https://example.com/"
                spellCheck={false}
              />
              <SegmentedControl
                value={String(form.status_code)}
                onChange={(v) => setForm({ ...form, status_code: Number(v) as 301 | 302 })}
                data={[
                  { value: "301", label: CODES[301] },
                  { value: "302", label: CODES[302] },
                ]}
              />
              <Text size="xs" c="dimmed" mt={-8}>
                通常は 301 です。検索エンジンにも新しい URL へ移ったことが伝わります。
              </Text>
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
          title="リダイレクトを削除しますか？"
          confirmLabel="削除する"
          danger
          onConfirm={async () => {
            await deleteRedirect(form.id!);
            toast("リダイレクトを削除しました");
            setForm(null);
            await load();
          }}
          onClose={() => setConfirmDelete(false)}
        >
          <Text size="sm">{form.from_path} への訪問は、次の公開から転送されなくなります。</Text>
        </ConfirmDialog>
      )}
    </Stack>
  );
}
