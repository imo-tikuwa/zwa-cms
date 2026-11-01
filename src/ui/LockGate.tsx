import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { info } from "@tauri-apps/plugin-log";
import { Button, Paper, Stack, Text, Title } from "@mantine/core";
import { Fingerprint, LockKeyhole } from "lucide-react";
import { quitApp } from "../lib/app";
import { busyLabels } from "../lib/busy";
import { LockStatus, lockNow, lockStatus, onLockChange, resetLock, unlock } from "../lib/lock";
import { Alert } from "./Alert";
import { ConfirmDialog } from "./ConfirmDialog";
import { TitleBar } from "./TitleBar";

const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel"] as const;

/**
 * Covers the app while it is locked (Windows Hello). At startup the app is not
 * mounted until unlocked, since it needs the secrets to load. A later lock
 * (after `minutes` without use, not counting AI or publishing in progress)
 * only covers it, so unsaved edits survive. Windows Hello is asked for only
 * from the lock screen's button.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LockStatus | null>(null);
  const [opened, setOpened] = useState(false);
  const refresh = useCallback(() => {
    lockStatus()
      .then((s) => {
        setStatus(s);
        if (!s.locked) setOpened(true);
      })
      // Without a status the lock cannot be on; never block the app on it.
      .catch(() => setOpened(true));
  }, []);
  useEffect(refresh, [refresh]);
  useEffect(() => onLockChange(refresh), [refresh]);

  // With quit_on_close, App handles the close button; before it is mounted
  // (locked at startup) nothing is open, so just quit.
  useEffect(() => {
    if (opened) return;
    const off = listen("close-requested", () => void quitApp());
    return () => void off.then((f) => f());
  }, [opened]);

  const locked = status?.locked ?? false;
  const lock = useCallback(() => void lockNow().then(refresh), [refresh]);
  useIdleLock(status, lock);

  if (!status && !opened) return null;
  return (
    <>
      {opened && children}
      {locked && <LockScreen overlay={opened} onUnlocked={refresh} />}
    </>
  );
}

/** Locks after `minutes` with no input and nothing busy. */
function useIdleLock(status: LockStatus | null, lock: () => void) {
  const last = useRef(Date.now());
  const active = !!status?.enabled && !status.locked && status.minutes > 0;
  useEffect(() => {
    if (!active || !status) return;
    last.current = Date.now();
    const touch = () => (last.current = Date.now());
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, touch, { passive: true });
    const timer = window.setInterval(() => {
      // AI and publishing count as work in progress.
      if (busyLabels().length > 0) touch();
      else if (Date.now() - last.current > status.minutes * 60_000) lock();
    }, 15_000);
    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, touch);
      window.clearInterval(timer);
    };
  }, [active, status, lock]);
}

/**
 * Windows Hello is asked for only when the button is pressed. Asking on its
 * own (at startup or when the window came forward) popped the PIN dialog
 * when the user had not asked for it, e.g. on coming back from the Windows
 * lock screen.
 */
function LockScreen({ overlay, onUnlocked }: { overlay: boolean; onUnlocked: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const tryUnlock = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void info("[lock] asking for Windows Hello (button)").catch(() => {});
    try {
      await unlock();
      onUnlocked();
    } catch (err) {
      const text = String(err);
      // Cancelling is not an error: the button is there to try again.
      if (!text.includes("取り消されました")) setError(text);
    } finally {
      setBusy(false);
    }
  };

  const screen = (
    <div className="center">
      <Paper withBorder radius="md" p="xl" shadow="sm" w="min(440px, 100%)">
        <Stack gap="md" align="center" ta="center">
          <LockKeyhole size={40} className="lock-icon" />
          <Title order={2} size="h3">
            ZWA CMS はロックされています
          </Title>
          <Text size="sm" c="dimmed">
            セキュリティのため、アプリケーションはユーザーの本人確認を行う必要があります。
          </Text>
          <Button
            size="md"
            variant="filled"
            leftSection={<Fingerprint size={18} />}
            loading={busy}
            onClick={() => void tryUnlock()}
          >
            Windows Hello で解除
          </Button>
          {error && (
            <Stack gap="xs" w="100%">
              <Alert level="error">{error}</Alert>
              <Text size="xs" c="dimmed">
                Windows Hello を設定し直した・Windows を入れ直したなどで解除できなくなったときは、ロックを外して API トークンを登録し直せます。
              </Text>
              <Button variant="default" size="xs" onClick={() => setConfirmReset(true)}>
                ロックを外して登録し直す
              </Button>
            </Stack>
          )}
        </Stack>
      </Paper>
      {confirmReset && (
        <ConfirmDialog
          title="ロックを外して、API トークンを登録し直しますか？"
          confirmLabel="ロックを外す"
          danger
          onConfirm={async () => {
            await resetLock();
            location.reload();
          }}
          onClose={() => setConfirmReset(false)}
        >
          <Text size="sm">
            この PC に保存している Cloudflare の API トークンと Claude の API キーを消して、ロックをオフにします。
            記事やメディアは Cloudflare にあるので消えません。トークンを登録し直すと、これまでのサイトをそのまま開けます。
          </Text>
        </ConfirmDialog>
      )}
    </div>
  );

  if (overlay) return <div className="lock-overlay">{screen}</div>;
  return (
    <div className="app">
      <TitleBar />
      {screen}
    </div>
  );
}
