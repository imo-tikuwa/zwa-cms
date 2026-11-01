import { Component, ReactNode } from "react";
import { Button, Code, Group, Stack, Text, Title } from "@mantine/core";
import { error } from "@tauri-apps/plugin-log";
import { openLogDir, quitApp } from "../lib/app";

type State = { error: Error | null };

/**
 * Shows the error instead of a blank window. The title bar is gone with the
 * rest of the UI, so this has its own reload and quit buttons.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(e: Error, info: { componentStack?: string | null }) {
    void error(`[webview] render failed: ${e.stack ?? e.message}${info.componentStack ?? ""}`).catch(() => {});
  }

  render() {
    const e = this.state.error;
    if (!e) return this.props.children;
    return (
      <div className="crash" data-tauri-drag-region>
        <Stack gap="md" maw={760}>
          <Title order={3}>画面の表示中にエラーが起きました</Title>
          <Text size="sm">
            内容はログにも書き出しています。再読み込みで直らないときは、下の内容を添えて報告してください。
          </Text>
          <Code block>{e.stack ?? String(e)}</Code>
          <Group>
            <Button onClick={() => location.reload()}>再読み込み</Button>
            <Button variant="default" onClick={() => void openLogDir().catch(() => {})}>
              ログのフォルダを開く
            </Button>
            <Button variant="default" onClick={() => void quitApp().catch(() => window.close())}>
              終了
            </Button>
          </Group>
        </Stack>
      </div>
    );
  }
}
