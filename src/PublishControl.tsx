import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ActionIcon, Badge, Button, Group, Modal, Stack, Text, Tooltip } from "@mantine/core";
import { CircleCheck, ExternalLink, Rocket } from "lucide-react";
import { PublishResult, publishSite } from "./lib/preview";
import { playSound } from "./lib/app";
import { Alert } from "./ui/Alert";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { notifyPublishStatusChange, usePublishStatus } from "./lib/publishStatus";

/** Builds the site without drafts and uploads it to Cloudflare Workers. */
export function PublishControl() {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  /** The finished publish, shown in a dialog until closed. */
  const [result, setResult] = useState<{ ok: PublishResult } | { error: string } | null>(null);
  const status = usePublishStatus();
  const pending = status?.pending ?? [];
  const count = pending.length + (status?.settings_changed ? 1 : 0);
  const pendingList = [
    ...pending.slice(0, 8).map((p) => `・${p.title || "無題"}`),
    ...(pending.length > 8 ? [`ほか ${pending.length - 8} 件`] : []),
    ...(status?.settings_changed ? ["・サイトの設定・テーマ"] : []),
  ];

  const publish = async () => {
    setConfirming(false);
    setBusy(true);
    setResult(null);
    try {
      const ok = await publishSite();
      setUrl(ok.url);
      setResult({ ok });
      playSound("info");
    } catch (err) {
      setResult({ error: String(err) });
      playSound("warning");
    } finally {
      setBusy(false);
      notifyPublishStatusChange();
    }
  };

  return (
    <Stack gap={4}>
      <Group gap={6} wrap="nowrap">
        <Tooltip
          multiline
          w={260}
          position="right"
          disabled={count === 0}
          label={
            <>
              <Text size="xs" fw={600}>
                サイトにまだ載っていない変更
              </Text>
              <Text size="xs" style={{ whiteSpace: "pre-line" }}>
                {pendingList.join("\n")}
              </Text>
            </>
          }
        >
          <Button
            variant="filled"
            flex={1}
            loading={busy}
            leftSection={<Rocket size={16} />}
            rightSection={
              count > 0 && (
                <Badge size="sm" circle={count < 10} color="white" c="var(--accent)" aria-label={`未反映 ${count} 件`}>
                  {count > 99 ? "99+" : count}
                </Badge>
              )
            }
            onClick={() => setConfirming(true)}
          >
            サイトに公開
          </Button>
        </Tooltip>
        {url && (
          <ActionIcon variant="default" size="lg" title={`公開サイトを開く（${url}）`} onClick={() => openUrl(url)}>
            <ExternalLink size={16} />
          </ActionIcon>
        )}
      </Group>
      {confirming && (
        <ConfirmDialog title="サイトに公開しますか？" confirmLabel="公開する" onConfirm={publish} onClose={() => setConfirming(false)}>
          <Text size="sm">「公開」にした記事と固定ページでサイトを作り直し、Cloudflare に送ります。下書きは載りません。</Text>
        </ConfirmDialog>
      )}
      <Modal
        opened={result !== null}
        onClose={() => setResult(null)}
        centered
        title={result && "ok" in result ? "サイトに公開しました" : "サイトに公開できませんでした"}
      >
        {result && "ok" in result && (
          <Stack gap="md">
            <Group gap="sm" wrap="nowrap">
              <CircleCheck size={20} color="var(--mantine-color-green-6)" />
              <Text size="sm">
                {result.ok.uploaded > 0
                  ? `${result.ok.files} ファイル（うち変更のあった ${result.ok.uploaded} 件を送信しました）`
                  : `${result.ok.files} ファイル（前回の公開から変わったファイルはありませんでした）`}
              </Text>
            </Group>
            {result.ok.warnings.length > 0 && <Alert level="warning">{result.ok.warnings.join("\n")}</Alert>}
            <Group justify="flex-end" gap="sm">
              <Button variant="default" onClick={() => setResult(null)}>
                閉じる
              </Button>
              <Button variant="filled" leftSection={<ExternalLink size={16} />} onClick={() => openUrl(result.ok.url)} data-autofocus>
                公開サイトを開く
              </Button>
            </Group>
          </Stack>
        )}
        {result && "error" in result && (
          <Stack gap="md">
            <Alert level="error">{result.error}</Alert>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setResult(null)} data-autofocus>
                閉じる
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
