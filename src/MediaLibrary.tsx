import { useEffect, useRef, useState } from "react";
import {
  Media,
  deleteMedia,
  formatSize,
  isImage,
  listMedia,
  previewUrl,
  publicPath,
  updateMedia,
  uploadMedia,
} from "./lib/media";
import { Box, Button, Checkbox, CloseButton, Code, Group, Paper, Stack, Text, TextInput, UnstyledButton } from "@mantine/core";
import { File as FileIcon, Trash2, Upload } from "lucide-react";
import { Alert } from "./ui/Alert";
import { toast } from "./ui/Toast";
import { formatDate } from "./lib/posts";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { PageHeader } from "./ui/PageHeader";

type Props = {
  /** When set, the library works as a picker (e.g. from the editor). */
  onPick?: (media: Media) => void;
  /** Picker only: shows a close button. */
  onClose?: () => void;
};

export function MediaLibrary({ onPick, onClose }: Props) {
  const [items, setItems] = useState<Media[] | null>(null);
  const [selected, setSelected] = useState<Media | null>(null);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Files ticked for bulk deletion (not in the picker). */
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const bulk = !onPick;

  const toggle = (id: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  /** Deletes the ticked files one by one; failures are listed, the rest go. */
  const deleteChecked = async () => {
    const failed: string[] = [];
    const left = new Set<number>();
    for (const id of checked) {
      const m = items?.find((x) => x.id === id);
      try {
        await deleteMedia(id);
        setItems((list) => list?.filter((x) => x.id !== id) ?? null);
        if (selected?.id === id) setSelected(null);
      } catch (err) {
        failed.push(`${m?.filename ?? id}: ${err}`);
        left.add(id);
      }
    }
    // Leave the failed ones ticked so they can be retried.
    setChecked(left);
    if (failed.length) throw new Error(`削除できなかったファイルがあります。\n${failed.join("\n")}`);
  };

  useEffect(() => {
    listMedia()
      .then(setItems)
      .catch((err) => setError(String(err)));
  }, []);

  const upload = async (files: FileList | File[]) => {
    setError(null);
    for (const file of Array.from(files)) {
      setUploading((n) => n + 1);
      try {
        const media = await uploadMedia(file);
        setItems((list) => [media, ...(list ?? []).filter((m) => m.id !== media.id)]);
        setSelected(media);
      } catch (err) {
        setError(`${file.name}: ${err}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  return (
    <div
      className={`media-library ${dragOver ? "drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        upload(e.dataTransfer.files);
      }}
    >
      <div className="media-main">
        <PageHeader title={onPick ? "メディアから選ぶ" : "メディア"}>
          {uploading > 0 && (
            <Text size="sm" c="dimmed">
              アップロード中…（残り {uploading}）
            </Text>
          )}
          <Button variant="filled" leftSection={<Upload size={16} />} onClick={() => fileInput.current?.click()}>
            アップロード
          </Button>
          {onClose && <CloseButton size="lg" aria-label="閉じる" title="閉じる" onClick={onClose} />}
        </PageHeader>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) upload(e.target.files);
            e.target.value = "";
          }}
        />
        <Text size="sm" c="dimmed">
          ファイルをこの画面にドラッグ＆ドロップしてもアップロードできます（1 ファイル 25MB まで）。
          {onPick ? " 選んで「挿入」を押すか、ダブルクリックします。" : " 左上のチェックで複数選んで、まとめて削除できます。"}
        </Text>
        {error && <Alert level="error">{error}</Alert>}
        {items === null && !error && <Text c="dimmed">読み込み中…</Text>}
        {items?.length === 0 && (
          <Paper withBorder p="xl" radius="md">
            <Text c="dimmed" ta="center" size="sm">
              メディアはまだありません。
            </Text>
          </Paper>
        )}
        <div className="media-grid">
          {items?.map((m) => (
            <div key={m.id} className={`media-tile-wrap${checked.has(m.id) ? " checked" : ""}${checked.size > 0 ? " selecting" : ""}`}>
              <UnstyledButton
                className={`media-tile ${selected?.id === m.id ? "selected" : ""}`}
                onClick={(e) => {
                  // While ticking files (or with Ctrl), a click ticks instead of opening.
                  if (bulk && (checked.size > 0 || e.ctrlKey || e.metaKey)) toggle(m.id);
                  else setSelected(m);
                }}
                onDoubleClick={() => onPick?.(m)}
                title={m.filename}
              >
                {isImage(m) ? (
                  <img src={previewUrl(m.r2_key)} alt={m.alt_text ?? ""} loading="lazy" />
                ) : (
                  <Stack gap={4} align="center" p="xs">
                    <FileIcon size={28} className="dim" />
                    <Text size="xs" ta="center" lineClamp={2}>
                      {m.filename}
                    </Text>
                  </Stack>
                )}
              </UnstyledButton>
              {bulk && (
                <Checkbox
                  className="media-check"
                  aria-label={`${m.filename} を選択`}
                  checked={checked.has(m.id)}
                  onChange={() => toggle(m.id)}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      {confirmBulk && (
        <ConfirmDialog
          title={`${checked.size} 件のファイルを削除しますか？`}
          confirmLabel="削除する"
          danger
          onConfirm={deleteChecked}
          onClose={() => setConfirmBulk(false)}
        >
          <Text size="sm">R2 から削除します。元に戻せません。</Text>
          <Text size="sm">これらのファイルを使っている記事では、画像が表示されなくなります。</Text>
        </ConfirmDialog>
      )}
      {/* Ticked files take the details pane: what is selected, and what to do with it. */}
      {bulk && checked.size > 0 && items && (
        <Paper component="aside" className="media-side" withBorder radius="md" p="md">
          <Stack gap="md">
            <Group justify="space-between" wrap="nowrap">
              <Text fw={700}>{checked.size} 件を選択中</Text>
              <CloseButton aria-label="選択を解除" title="選択を解除" onClick={() => setChecked(new Set())} />
            </Group>
            <div className="media-bulk-thumbs">
              {items
                .filter((m) => checked.has(m.id))
                .map((m) => (
                  <div key={m.id} className="media-bulk-thumb" title={m.filename}>
                    {isImage(m) ? <img src={previewUrl(m.r2_key)} alt="" /> : <FileIcon size={18} className="dim" />}
                  </div>
                ))}
            </div>
            <Text size="sm" c="dimmed">
              合計 {formatSize(items.filter((m) => checked.has(m.id)).reduce((n, m) => n + m.size_bytes, 0))}。ファイルをクリックすると、選択に加えたり外したりできます。
            </Text>
            <Group gap="xs">
              <Button size="xs" variant="subtle" color="gray" onClick={() => setChecked(new Set(items.map((m) => m.id)))}>
                すべて選択
              </Button>
              <Button size="xs" variant="subtle" color="gray" onClick={() => setChecked(new Set())}>
                選択を解除
              </Button>
            </Group>
            <Box pt="sm" style={{ borderTop: "1px solid var(--border)" }}>
              <Button variant="filled" color="red" fullWidth leftSection={<Trash2 size={16} />} onClick={() => setConfirmBulk(true)}>
                {checked.size} 件を削除
              </Button>
            </Box>
          </Stack>
        </Paper>
      )}
      {selected && !(bulk && checked.size > 0) && (
        <MediaDetails
          key={selected.id}
          media={selected}
          onPick={onPick}
          onChange={(m) => {
            setSelected(m);
            setItems((list) => list?.map((x) => (x.id === m.id ? m : x)) ?? null);
          }}
          onDelete={() => {
            setItems((list) => list?.filter((x) => x.id !== selected.id) ?? null);
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}

function MediaDetails({
  media,
  onPick,
  onChange,
  onDelete,
}: {
  media: Media;
  onPick?: (m: Media) => void;
  onChange: (m: Media) => void;
  onDelete: () => void;
}) {
  const [alt, setAlt] = useState(media.alt_text ?? "");
  const [caption, setCaption] = useState(media.caption ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = alt !== (media.alt_text ?? "") || caption !== (media.caption ?? "");

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateMedia(media.id, alt, caption);
      onChange({ ...media, alt_text: alt || null, caption: caption || null });
      toast("画像の情報を保存しました");
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper component="aside" className="media-side" withBorder radius="md" p="md">
      <Stack gap="md">
        {isImage(media) && <img className="media-preview" src={previewUrl(media.r2_key)} alt="" />}
        <dl className="media-facts">
          <dt>ファイル名</dt>
          <dd>{media.filename}</dd>
          <dt>URL</dt>
          <dd>
            <Code>{publicPath(media)}</Code>
          </dd>
          <dt>サイズ</dt>
          <dd>
            {formatSize(media.size_bytes)}
            {media.width && ` / ${media.width}×${media.height}`}
          </dd>
          <dt>追加日</dt>
          <dd>{formatDate(media.created_at)}</dd>
        </dl>
        <TextInput
          label="代替テキスト"
          description="画像が見られない人や検索エンジン向けの説明です。"
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          placeholder="画像の内容を短く説明"
        />
        <TextInput label="キャプション" description="本文で画像の下に表示します。" value={caption} onChange={(e) => setCaption(e.target.value)} />
        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}
        <Group gap="xs" grow>
          <Button disabled={busy || !dirty} onClick={save}>
            保存
          </Button>
          {onPick && (
            <Button
              variant="filled"
              loading={busy}
              onClick={async () => {
                if (!dirty || (await save())) onPick({ ...media, alt_text: alt || null, caption: caption || null });
              }}
            >
              挿入
            </Button>
          )}
        </Group>
        <Box pt="sm" style={{ borderTop: "1px solid var(--border)" }}>
          <Button variant="subtle" color="red" leftSection={<Trash2 size={16} />} disabled={busy} onClick={() => setConfirmDelete(true)}>
            このファイルを削除
          </Button>
        </Box>
        {confirmDelete && (
          <ConfirmDialog
            title="ファイルを削除しますか？"
            confirmLabel="削除する"
            danger
            onConfirm={async () => {
              await deleteMedia(media.id);
              onDelete();
            }}
            onClose={() => setConfirmDelete(false)}
          >
            <Text size="sm">R2 から削除します。元に戻せません。</Text>
            <Text size="sm">このファイルを使っている記事では、画像が表示されなくなります。</Text>
          </ConfirmDialog>
        )}
      </Stack>
    </Paper>
  );
}
