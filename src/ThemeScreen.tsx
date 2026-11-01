import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FolderDown, FolderOpen, FolderUp, ImagePlus, RotateCcw, X } from "lucide-react";
import { previewUrl } from "./lib/media";
import { SiteSettings, getSiteSettings, saveSiteSettings } from "./lib/siteSettings";
import {
  ThemeStatus,
  exportDefaultTheme,
  resetTheme,
  setThemeDevDir,
  themeStatus,
  uploadTheme,
} from "./lib/themeFiles";
import { MediaPicker } from "./MediaPicker";
import { Badge, Button, Code, ColorInput, Group, Input, SegmentedControl, Stack, Switch, Text, TextInput, Textarea } from "@mantine/core";
import { Alert } from "./ui/Alert";
import { toast } from "./ui/Toast";
import { Card } from "./ui/Card";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { PageHeader } from "./ui/PageHeader";
import { MessageText } from "./ui/CopyButton";

const DESIGN_KEYS = [
  "theme.accent_color",
  "theme.color_mode",
  "theme.brightness",
  "theme.color_switch",
  "theme.logo",
  "theme.favicon",
  "theme.footer_text",
  "theme.custom_css",
];
// Values as the site generator reads them (crates/zwa-site, keys::COLOR_MODE …); "" = the default.
const COLOR_MODES = [
  { value: "", label: "閲覧者の OS に合わせる" },
  { value: "light", label: "ライト" },
  { value: "dark", label: "ダーク" },
];
const BRIGHTNESS = [
  { value: "-1", label: "暗め" },
  { value: "", label: "標準" },
  { value: "1", label: "明るめ" },
];
const DEFAULT_ACCENT = "#2f6feb";

type Message = { error: boolean; text: string } | null;

export function ThemeScreen({ onChanged }: { onChanged: () => void }) {
  return (
    <div className="setup">
      <PageHeader title="テーマ" />
      <DesignSettings onChanged={onChanged} />
      <ThemeFiles onChanged={onChanged} />
    </div>
  );
}

/** A: simple settings applied on top of the theme. */
function DesignSettings({ onChanged }: { onChanged: () => void }) {
  const [values, setValues] = useState<SiteSettings | null>(null);
  const [picking, setPicking] = useState<"theme.logo" | "theme.favicon" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  useEffect(() => {
    getSiteSettings()
      .then(setValues)
      .catch((err) => setMessage({ error: true, text: String(err) }));
  }, []);

  if (!values) return message ? <Alert level="error">{message.text}</Alert> : <Text c="dimmed">読み込み中…</Text>;

  const set = (key: string, value: string) => setValues({ ...values, [key]: value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await saveSiteSettings(Object.fromEntries(DESIGN_KEYS.map((k) => [k, values[k] ?? ""])));
      toast("デザイン設定を保存しました");
      onChanged();
    } catch (err) {
      setMessage({ error: true, text: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const imageField = (key: "theme.logo" | "theme.favicon", label: string, help: string) => (
    <Input.Wrapper label={label} description={help}>
      <Group gap="sm" mt={6}>
        {values[key] ? (
          <>
            <img className="design-thumb" src={previewUrl(values[key])} alt="" />
            <Code>{values[key]}</Code>
            <Button size="xs" onClick={() => setPicking(key)}>
              変更
            </Button>
            <Button size="xs" variant="subtle" color="gray" leftSection={<X size={14} />} onClick={() => set(key, "")}>
              外す
            </Button>
          </>
        ) : (
          <Button size="xs" leftSection={<ImagePlus size={14} />} onClick={() => setPicking(key)}>
            メディアから選ぶ
          </Button>
        )}
      </Group>
    </Input.Wrapper>
  );

  return (
    <Card title="デザイン設定" description="どのテーマでも使える、簡単な見た目の設定です。" onSubmit={save}>
      <Group gap="sm" align="flex-end">
        <ColorInput
          label="強調色"
          description="リンクやボタンなどの色です。空欄なら既定の色です。"
          w={400}
          value={values["theme.accent_color"] ?? ""}
          placeholder={DEFAULT_ACCENT}
          onChange={(v) => set("theme.accent_color", v)}
          format="hex"
          error={
            values["theme.accent_color"] && !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(values["theme.accent_color"].trim())
              ? "#c2410c のような形式で入力してください"
              : undefined
          }
        />
        {values["theme.accent_color"] && (
          <Button variant="subtle" color="gray" size="xs" mb={22} onClick={() => set("theme.accent_color", "")}>
            既定に戻す
          </Button>
        )}
      </Group>
      <Input.Wrapper label="ライト・ダーク">
        <Stack gap="sm" mt={6}>
          <Switch
            label="閲覧者がヘッダーのボタンで切り替えられるようにする"
            checked={values["theme.color_switch"] === "on"}
            onChange={(e) => set("theme.color_switch", e.currentTarget.checked ? "on" : "")}
          />
          <div className="design-choice">
            <Text size="sm" w={110}>
              {values["theme.color_switch"] === "on" ? "最初の表示" : "表示"}
            </Text>
            <SegmentedControl
              size="xs"
              value={values["theme.color_mode"] ?? ""}
              onChange={(v) => set("theme.color_mode", v)}
              data={COLOR_MODES}
            />
          </div>
          <div className="design-choice">
            <Text size="sm" w={110}>
              {values["theme.color_switch"] === "on" ? "最初の明るさ" : "明るさ"}
            </Text>
            <SegmentedControl
              size="xs"
              value={values["theme.brightness"] ?? ""}
              onChange={(v) => set("theme.brightness", v)}
              data={BRIGHTNESS}
            />
          </div>
          <Text size="xs" c="dimmed">
            {values["theme.color_switch"] === "on"
              ? "閲覧者が切り替えると、次からはその人のブラウザで選んだ表示になります。"
              : "どの閲覧者にもこの表示で見せます。"}
            プレビューは、このアプリのライト・ダークに合わせて表示することがあります。
          </Text>
        </Stack>
      </Input.Wrapper>
      {imageField("theme.logo", "ロゴ", "ヘッダーのサイト名の左に表示します（高さ 32px）。")}
      {imageField("theme.favicon", "ファビコン（favicon）", "ブラウザのタブに表示するアイコンです。正方形の PNG がおすすめです。")}
      <TextInput
        label="フッターの文言"
        value={values["theme.footer_text"] ?? ""}
        onChange={(e) => set("theme.footer_text", e.target.value)}
        placeholder="空欄の場合は「© サイト名」"
      />
      <Textarea
        label="追加 CSS"
        description="すべてのページの最後に読み込まれます。"
        autosize
        minRows={5}
        value={values["theme.custom_css"] ?? ""}
        onChange={(e) => set("theme.custom_css", e.target.value)}
        placeholder={".site-title { letter-spacing: 0.05em; }"}
        spellCheck={false}
        styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)", fontSize: 13 } }}
      />
      <Group gap="sm">
        <Button type="submit" variant="filled" loading={busy}>
          保存
        </Button>
        {message && (
          <MessageText size="sm" error={message.error}>
            {message.text}
          </MessageText>
        )}
      </Group>
      {picking && (
        <MediaPicker
          onPick={(m) => {
            set(picking, `/${m.r2_key}`);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </Card>
  );
}

/** B: replace the theme with files from a folder. */
function ThemeFiles({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState<ThemeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  useEffect(() => {
    themeStatus()
      .then(setStatus)
      .catch((err) => setMessage({ error: true, text: String(err) }));
  }, []);

  const run = async (action: () => Promise<ThemeStatus | void>, done?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const next = await action();
      if (next) setStatus(next);
      if (done) toast(done);
      onChanged();
    } catch (err) {
      setMessage({ error: true, text: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const pickFolder = async (title: string) => {
    const dir = await open({ directory: true, title });
    return typeof dir === "string" ? dir : null;
  };

  const custom = (status?.files.length ?? 0) > 0;

  return (
    <Card
      title="テーマファイル"
      description="HTML テンプレートと CSS を編集して、見た目を自由に変えられます。既定のテーマを書き出して編集し、フォルダごとアップロードします。アップロードしたテーマはサイトの R2 に保存され、どの PC から公開しても同じテーマになります。"
    >
      {status && (
        <Group gap="xs">
          <Text size="sm" c="dimmed">
            使用中のテーマ
          </Text>
          <Badge variant={custom ? "filled" : "light"} tt="none">
            {custom ? `カスタムテーマ（${status.files.length} ファイル）` : "既定のテーマ"}
          </Badge>
        </Group>
      )}
      <Group gap="sm">
        <Button
          leftSection={<FolderDown size={16} />}
          disabled={busy}
          onClick={() =>
            run(async () => {
              const dir = await pickFolder("書き出し先のフォルダを選択");
              if (!dir) return;
              const path = await exportDefaultTheme(dir);
              setMessage({ error: false, text: `${path} に書き出しました。README.md に書き方の説明があります。` });
              await revealItemInDir(path).catch(() => {});
            })
          }
        >
          既定のテーマを書き出す
        </Button>
        <Button
          variant="filled"
          leftSection={<FolderUp size={16} />}
          loading={busy}
          onClick={() =>
            run(async () => {
              const dir = await pickFolder("アップロードするテーマのフォルダを選択");
              if (!dir) return;
              return uploadTheme(dir);
            }, "アップロードしました。次回の公開から反映されます。")
          }
        >
          フォルダからアップロード
        </Button>
        {custom && (
          <Button variant="subtle" color="red" leftSection={<RotateCcw size={16} />} disabled={busy} onClick={() => setConfirmReset(true)}>
            既定のテーマに戻す
          </Button>
        )}
      </Group>
      {confirmReset && (
        <ConfirmDialog
          title="既定のテーマに戻しますか？"
          confirmLabel="既定に戻す"
          danger
          onConfirm={() => run(resetTheme, "既定のテーマに戻しました。")}
          onClose={() => setConfirmReset(false)}
        >
          <Text size="sm">R2 にアップロードしたテーマファイルを削除します。元に戻せません（手元のフォルダは消えません）。</Text>
          <Text size="sm">デザイン設定（色など）はそのまま残ります。</Text>
        </ConfirmDialog>
      )}

      <Input.Wrapper
        label="作業用フォルダ（この PC のプレビュー専用）"
        description="指定すると、プレビューはアップロード済みのテーマではなく、このフォルダのテーマで表示します。編集後に「再ビルドして開く」で確認できます。公開には使いません。"
      >
        <Group gap="xs" mt={6}>
          {status?.dev_dir ? (
            <>
              <Code className="selectable">{status.dev_dir}</Code>
              <Button size="xs" variant="subtle" color="gray" leftSection={<FolderOpen size={14} />} onClick={() => revealItemInDir(status.dev_dir!).catch(() => {})}>
                開く
              </Button>
              <Button
                size="xs"
                variant="subtle"
                color="gray"
                leftSection={<X size={14} />}
                disabled={busy}
                onClick={() => run(() => setThemeDevDir(null), "作業用フォルダを解除しました。")}
              >
                解除
              </Button>
            </>
          ) : (
            <Button
              size="xs"
              leftSection={<FolderOpen size={14} />}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const dir = await pickFolder("作業用のテーマフォルダを選択");
                  if (!dir) return;
                  return setThemeDevDir(dir);
                }, "作業用フォルダを設定しました。プレビューに反映されます。")
              }
            >
              フォルダを指定
            </Button>
          )}
        </Group>
      </Input.Wrapper>
      {message && (message.error ? <Alert level="error">{message.text}</Alert> : <Alert level="success">{message.text}</Alert>)}
    </Card>
  );
}
