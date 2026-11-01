import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, Code, Paper, PasswordInput, Stack, Text, Timeline, Title } from "@mantine/core";
import { ExternalLink } from "lucide-react";
import { Alert } from "./ui/Alert";
import { AuthStatus, TOKEN_PAGE, signInWithToken } from "./lib/auth";
import { FORMS_PERMISSION } from "./lib/forms";

// Permissions the app will need for setup, editing and publishing.
const PERMISSIONS = [
  "Account · D1 · Edit",
  "Account · Workers R2 Storage · Edit",
  "Account · Workers Scripts · Edit",
];

export function SignIn({ onSignedIn }: { onSignedIn: (s: AuthStatus) => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await signInWithToken(token));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="center">
      <Paper withBorder radius="md" p="xl" shadow="sm" component="form" onSubmit={submit} w="min(600px, 100%)">
        <Stack gap="lg">
          <Stack gap={6}>
            <Title order={1} size="h3">
              Cloudflare に接続
            </Title>
            <Text size="sm" c="dimmed">
              Cloudflare の「ユーザー API トークン」（My Profile → API Tokens）を作って貼り付けてください。アカウント API トークンではありません。トークンはこの PC のキーチェーンに保存されます。
            </Text>
          </Stack>
          <Timeline bulletSize={26} lineWidth={2} active={-1}>
            <Timeline.Item bullet={<Text size="xs" fw={700}>1</Text>} title="API トークンの管理画面を開く">
              <Stack gap={6} mt={4}>
                <Text size="sm" c="dimmed">
                  カスタムトークン（Create Custom Token）を作ります。
                </Text>
                <div>
                  <Button size="xs" leftSection={<ExternalLink size={14} />} onClick={() => openUrl(TOKEN_PAGE)}>
                    API トークンの管理画面を開く
                  </Button>
                </div>
              </Stack>
            </Timeline.Item>
            <Timeline.Item bullet={<Text size="xs" fw={700}>2</Text>} title="権限を追加する（対象は使うアカウント）">
              <Stack gap={4} mt={4} align="flex-start">
                {PERMISSIONS.map((p) => (
                  <Code key={p}>{p}</Code>
                ))}
                <Text size="xs" c="dimmed" mt={4}>
                  問い合わせフォームを使う場合は <Code>{FORMS_PERMISSION}</Code> も追加します（後からトークンを編集して追加することもできます）。
                </Text>
              </Stack>
            </Timeline.Item>
            <Timeline.Item bullet={<Text size="xs" fw={700}>3</Text>} title="作ったトークンをコピーして下に貼り付ける" />
          </Timeline>
          <PasswordInput
            label="ユーザー API トークン"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
          {error && <Alert level="error">{error}</Alert>}
          <Button type="submit" variant="filled" loading={busy} disabled={!token.trim()}>
            接続する
          </Button>
        </Stack>
      </Paper>
    </main>
  );
}
