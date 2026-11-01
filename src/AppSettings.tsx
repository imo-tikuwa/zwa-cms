import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AppWindow, ExternalLink, FolderOpen, KeyRound, PenLine, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { fieldButtonsEnabled, setFieldButtonsEnabled } from "./AiAssistant";
import { AiStatus, MODEL_LABELS, aiStatus, deleteAiKey, setAiKey, setDefaultModel } from "./lib/ai";
import { WindowPrefs, openLogDir, setWindowPrefs, windowPrefs } from "./lib/app";
import { EditorMode, defaultEditorMode, setDefaultEditorMode } from "./lib/posts";
import {
  LOCK_MINUTES,
  LockStatus,
  disableLock,
  enableLock,
  lockMinutesLabel,
  lockStatus,
  notifyLockChange,
  setLockMinutes,
} from "./lib/lock";
import { Badge, Button, Group, PasswordInput, Radio, Stack, Switch, Text } from "@mantine/core";
import { Alert } from "./ui/Alert";
import { toast } from "./ui/Toast";
import { Card } from "./ui/Card";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { Menu } from "./ui/Menu";
import { Section, SectionLayout } from "./ui/SectionLayout";

const CONSOLE_KEYS = "https://platform.claude.com/settings/keys";

type Message = { error: boolean; text: string } | null;

export type AppSettingsSection = "window" | "security" | "ai" | "editor";

const SECTIONS: Section<AppSettingsSection>[] = [
  { key: "window", label: "ウィンドウと通知", icon: <AppWindow size={16} /> },
  { key: "security", label: "セキュリティ", icon: <ShieldCheck size={16} /> },
  { key: "ai", label: "AI", icon: <Sparkles size={16} /> },
  { key: "editor", label: "編集画面", icon: <PenLine size={16} /> },
];

type Props = {
  onKeyChange: (hasKey: boolean) => void;
  section: AppSettingsSection;
  onSection: (section: AppSettingsSection) => void;
};

/**
 * Settings for this PC, shared by every site (opened from the title bar).
 * Sections on the left, so more can be added without a long page.
 */
export function AppSettings({ onKeyChange, section, onSection }: Props) {
  return (
    <SectionLayout
      title="アプリの設定"
      description="この PC だけの設定です。すべてのサイトに共通です。"
      sections={SECTIONS}
      active={section}
      onSelect={onSection}
    >
      {section === "window" && (
        <>
          <WindowCard />
          <LogCard />
        </>
      )}
      {section === "security" && <LockCard />}
      {section === "ai" && (
        <>
          <ApiKeyCard onKeyChange={onKeyChange} />
          <DefaultModelCard />
          <FieldButtonsCard />
        </>
      )}
      {section === "editor" && <EditorCard />}
    </SectionLayout>
  );
}

/** The model for sites that don't choose their own (AI screen). */
function DefaultModelCard() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    aiStatus()
      .then(setStatus)
      .catch((err) => setError(String(err)));
  }, []);

  return (
    <Card
      title="既定のモデル"
      description="サイトの「AI」画面でモデルを「PC の既定のモデルを使う」にしているサイトで使います。サイトごとに決めたモデルがあれば、そちらが優先です。"
    >
      {status && (
        <Radio.Group
          value={status.default_model}
          onChange={async (model) => {
            setError(null);
            try {
              setStatus(await setDefaultModel(model));
              toast("既定のモデルを変更しました");
            } catch (err) {
              setError(String(err));
            }
          }}
        >
          <Stack gap="xs">
            {status.models.map((m) => (
              <Radio key={m} value={m} label={MODEL_LABELS[m] ?? m} />
            ))}
          </Stack>
        </Radio.Group>
      )}
      {error && <Alert level="error">{error}</Alert>}
    </Card>
  );
}

/** Per-machine: the key lives in this PC's keychain. */
function ApiKeyCard({ onKeyChange }: { onKeyChange: (hasKey: boolean) => void }) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  useEffect(() => {
    aiStatus()
      .then(setStatus)
      .catch((err) => setMessage({ error: true, text: String(err) }));
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const next = await setAiKey(key);
      setStatus(next);
      onKeyChange(next.has_key);
      setKey("");
      toast("API キーを登録しました");
      setMessage({
        error: false,
        text: "Claude API に接続できることを確かめて、登録しました。記事の編集画面に「AI アシスタント」が表示されます。モデルや執筆方針は、サイトごとに左のメニューの「AI」で設定します。",
      });
    } catch (err) {
      setMessage({ error: true, text: String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Claude の API キー"
      description="AI 機能は Anthropic の Claude API を使います。Claude Console で API キーを作って貼り付けてください。料金は Console で購入したクレジット（前払い）から引かれ、残高がなくなると止まります。キーはこの PC のキーチェーンに保存されます。"
      actions={
        <Button
          size="xs"
          variant="subtle"
          color="gray"
          leftSection={<ExternalLink size={14} />}
          onClick={() => openUrl(CONSOLE_KEYS)}
        >
          Claude Console を開く
        </Button>
      }
      onSubmit={save}
    >
      {status?.has_key ? (
        <Group gap="sm">
          <Badge variant="light" size="lg" tt="none" leftSection={<KeyRound size={14} />}>
            登録済み
          </Badge>
          <Button
            variant="subtle"
            color="red"
            size="xs"
            leftSection={<Trash2 size={14} />}
            onClick={() => setConfirmDelete(true)}
          >
            キーを削除
          </Button>
          {confirmDelete && (
            <ConfirmDialog
              title="API キーを削除しますか？"
              confirmLabel="削除する"
              danger
              onConfirm={async () => {
                const next = await deleteAiKey();
                setStatus(next);
                onKeyChange(next.has_key);
                toast("API キーを削除しました");
              }}
              onClose={() => setConfirmDelete(false)}
            >
              <Text size="sm">
                この PC のキーチェーンから削除します。キー自体は、Claude Console で無効にするまで使える状態のままです。
              </Text>
            </ConfirmDialog>
          )}
        </Group>
      ) : (
        <Stack gap="sm" align="flex-start">
          <PasswordInput
            label="API キー"
            w="100%"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-..."
            description="登録する前に、Claude API に接続できるかを確かめます（料金はかかりません）。"
          />
          <Button type="submit" variant="filled" loading={busy} disabled={!key.trim()}>
            確認して登録
          </Button>
        </Stack>
      )}
      {message && (message.error ? <Alert level="error">{message.text}</Alert> : <Alert level="success">{message.text}</Alert>)}
    </Card>
  );
}

function EditorCard() {
  const [mode, setMode] = useState(defaultEditorMode);
  return (
    <Card title="編集画面">
      <Radio.Group
        label="本文を開いたときの編集方法"
        description="記事・固定ページを開いたときの表示です。編集画面の「編集方法」でいつでも切り替えられます。"
        value={mode}
        onChange={(v) => {
          setMode(v as EditorMode);
          setDefaultEditorMode(v as EditorMode);
          toast("設定を保存しました");
        }}
      >
        <Stack gap="xs" mt="xs">
          <Radio value="visual" label="ビジュアル" />
          <Radio value="source" label="Markdown（WordPress から取り込んだ記事は HTML）" />
        </Stack>
      </Radio.Group>
    </Card>
  );
}

/** The ✨ buttons beside the post editor's fields. */
function FieldButtonsCard() {
  const [fieldButtons, setFieldButtons] = useState(fieldButtonsEnabled);
  return (
    <Card title="入力欄の AI ボタン">
      <Switch
        label="タイトル・スラッグ・抜粋の欄に AI ボタン（✨）を表示する"
        description="記事の編集画面で、押すとその欄の案を AI が出します。API キーを登録しているときだけ表示されます。"
        checked={fieldButtons}
        onChange={(e) => {
          setFieldButtons(e.currentTarget.checked);
          setFieldButtonsEnabled(e.currentTarget.checked);
          toast("設定を保存しました");
        }}
      />
    </Card>
  );
}

function WindowCard() {
  const [prefs, setPrefs] = useState<WindowPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    windowPrefs()
      .then(setPrefs)
      .catch((err) => setError(String(err)));
  }, []);

  const update = async (patch: Partial<WindowPrefs>) => {
    if (!prefs) return;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try {
      await setWindowPrefs(next);
      setError(null);
      toast("設定を保存しました");
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <Card title="ウィンドウと通知">
      {prefs && (
        <Stack gap="lg">
          <Switch
            label="閉じてもタスクトレイに常駐する"
            description="AI の処理やプレビューは閉じた後も続きます。終了はタスクトレイのアイコンのメニューから行います。オフにすると閉じるボタンで終了し、処理中の作業や保存していない変更があるときは確認します。"
            checked={!prefs.quit_on_close}
            onChange={(e) => update({ quit_on_close: !e.currentTarget.checked })}
          />
          <Switch
            label="作業が終わったらデスクトップに通知する"
            description="ウィンドウを閉じている間や最小化している間に、AI の処理・サイトの公開が終わったときや、問い合わせが届いたときに通知します。"
            checked={!prefs.notify_off}
            onChange={(e) => update({ notify_off: !e.currentTarget.checked })}
          />
          <Switch
            label="確認のときに Windows の通知音を鳴らす"
            description="削除など取り消せない操作では警告音、それ以外は情報の音です（Windows のサウンド設定に従います）。"
            checked={!prefs.sound_off}
            onChange={(e) => update({ sound_off: !e.currentTarget.checked })}
          />
        </Stack>
      )}
      {error && <Alert level="error">{error}</Alert>}
    </Card>
  );
}

function LogCard() {
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title="ログ" description="公開の進み具合やエラーを記録しています。うまく動かないときの報告に添えてください。">
      <Group>
        <Button
          variant="default"
          leftSection={<FolderOpen size={16} />}
          onClick={() =>
            openLogDir().then(
              () => setError(null),
              (err) => setError(String(err)),
            )
          }
        >
          ログのフォルダを開く
        </Button>
      </Group>
      {error && <Alert level="error">{error}</Alert>}
    </Card>
  );
}

function LockCard() {
  const [status, setStatus] = useState<LockStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  const load = () => lockStatus().then(setStatus, (err) => setError(String(err)));
  useEffect(() => void load(), []);

  const run = async (task: () => Promise<void>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await task();
      await load();
      notifyLockChange();
      toast(done);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Windows Hello でロックする"
      description="Windows Hello（Windows へのサインインに使う PIN など）で解除するまで、アプリを使えないようにします。"
      actions={status?.enabled && <Badge variant="light">オン</Badge>}
    >
      {status && !status.supported && (
        <Alert level="info" title="この PC では Windows Hello が使えません">
          Windows の設定の「アカウント」→「サインイン オプション」で Windows Hello の PIN を設定すると使えるようになります。
        </Alert>
      )}
      {status?.supported && (
        <Stack gap="lg">
          <Stack gap={4}>
            <Text size="sm">オンにすると、次のようになります。</Text>
            <Text component="ul" size="sm" c="dimmed" m={0} pl="lg">
              <li>Cloudflare の API トークンと Claude の API キーを暗号化して保存します</li>
              <li>アプリを起動したときは、ロックを解除するまで使えません</li>
              <li>しばらく操作しないと、自動でロックします</li>
            </Text>
          </Stack>
          <Group>
            {status.enabled ? (
              <Button variant="default" disabled={busy} onClick={() => setConfirmOff(true)}>
                オフにする
              </Button>
            ) : (
              <Button leftSection={<ShieldCheck size={16} />} loading={busy} onClick={() => void run(enableLock, "Windows Hello のロックをオンにしました")}>
                オンにする
              </Button>
            )}
          </Group>
          {status.enabled && (
            <Stack gap={4}>
              <Text size="sm" fw={600}>
                自動でロックするまでの時間
              </Text>
              <Group gap="sm">
                <Menu
                  fullWidth={false}
                  label={lockMinutesLabel(status.minutes)}
                  items={LOCK_MINUTES.map((m) => ({
                    key: String(m),
                    label: lockMinutesLabel(m),
                    checked: m === status.minutes,
                    onSelect: () => void run(() => setLockMinutes(m), `自動でロックするまでの時間を「${lockMinutesLabel(m)}」にしました`),
                  }))}
                />
              </Group>
              <Text size="xs" c="dimmed">
                操作しない時間がこれを超えるとロックします。AI の処理中・公開中は数えません。
              </Text>
            </Stack>
          )}
        </Stack>
      )}
      {error && <Alert level="error">{error}</Alert>}
      {confirmOff && (
        <ConfirmDialog
          title="Windows Hello のロックをオフにしますか？"
          confirmLabel="オフにする"
          danger
          onConfirm={async () => {
            await disableLock();
            toast("Windows Hello のロックをオフにしました");
            await load();
            notifyLockChange();
          }}
          onClose={() => setConfirmOff(false)}
        >
          <Text size="sm">API トークンと API キーを、暗号化せずに保存し直します。</Text>
        </ConfirmDialog>
      )}
    </Card>
  );
}
