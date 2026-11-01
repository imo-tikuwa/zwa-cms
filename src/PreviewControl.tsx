import { forwardRef, useImperativeHandle, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ActionIcon, Button, Group, Stack, Text } from "@mantine/core";
import { Eye, ExternalLink } from "lucide-react";
import { buildPreview } from "./lib/preview";
import { MessageText } from "./ui/CopyButton";

export type PreviewHandle = {
  /** Rebuilds if a preview has been opened in this session. */
  refresh: () => void;
  /** Builds and opens a page (e.g. `/posts/hello/`) in the browser. */
  open: (path: string | null) => void;
};

type Props = {
  /** The page being edited; the button opens it instead of the top page. */
  path?: string | null;
};

/** Sidebar button that builds the site and opens it in the browser. */
export const PreviewControl = forwardRef<PreviewHandle, Props>(function PreviewControl({ path }, ref) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  /** `open`: the path to show afterwards, or false to only rebuild. */
  const build = async (open: string | false) => {
    setBusy(true);
    try {
      const result = await buildPreview();
      setUrl(result.url);
      setMessage(
        result.warnings.length
          ? { error: true, text: result.warnings.join("\n") }
          : { error: false, text: `${result.files} ファイルを生成しました` },
      );
      if (open !== false) await openUrl(result.url.replace(/\/$/, "") + encodeURI(open || "/"));
    } catch (err) {
      setMessage({ error: true, text: String(err) });
    } finally {
      setBusy(false);
    }
  };

  useImperativeHandle(ref, () => ({
    refresh: () => {
      if (url && !busy) build(false);
    },
    open: (p) => {
      if (!busy) build(p ?? "/");
    },
  }));

  return (
    <Stack gap={4}>
      <Group gap={6} wrap="nowrap">
        <Button
          flex={1}
          loading={busy}
          leftSection={<Eye size={16} />}
          title={path ? "編集中のページを開きます" : "トップページを開きます"}
          onClick={() => build(path ?? "/")}
        >
          プレビュー
        </Button>
        {url && (
          <ActionIcon variant="default" size="lg" title={`ブラウザで開く（${url}）`} onClick={() => openUrl(url)}>
            <ExternalLink size={16} />
          </ActionIcon>
        )}
      </Group>
      {url && (
        <Text size="xs" c="dimmed">
          保存すると自動で作り直します
        </Text>
      )}
      {message && (
        <MessageText size="xs" error={message.error}>
          {message.text}
        </MessageText>
      )}
    </Stack>
  );
});
