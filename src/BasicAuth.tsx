import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Group,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { Card } from "./ui/Card";
import { Alert } from "./ui/Alert";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { MessageText } from "./ui/CopyButton";
import { toast } from "./ui/Toast";
import { clearBasicAuth, getBasicAuth, setBasicAuth } from "./lib/basicAuth";
import { notifyPublishStatusChange } from "./lib/publishStatus";

/** Basic authentication for the whole published site ("サイト情報"). */
export function BasicAuthCard() {
  // undefined while loading, null when off.
  const [user, setUser] = useState<string | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    getBasicAuth()
      .then((u) => {
        setUser(u);
        setName(u ?? "");
      })
      .catch((err) => setLoadError(String(err)));
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await setBasicAuth(name, password);
      toast(user ? "Basic 認証を変更しました" : "Basic 認証を設定しました", {
        description: "サイトに反映されるのは次の公開からです",
      });
      setUser(name.trim());
      setPassword("");
      setEditing(false);
      notifyPublishStatusChange();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  if (loadError) return <Alert level="error">{loadError}</Alert>;
  if (user === undefined) return null;
  const showForm = !user || editing;
  return (
    <Card
      title="Basic 認証"
      description="公開サイト全体に、ユーザー名とパスワードをかけます。公開前の確認や、関係者だけに見せるときに使います。"
      actions={user && <Badge variant="light">有効</Badge>}
    >
      <Text size="xs" c="dimmed">
        パスワードはこのサイトの D1 に、ソルト付きの SHA-256
        だけを保存します（元のパスワードは保存しないので、後から表示できません）。GitHub
        Actions からの公開でも同じ認証がかかります。プレビューにはかかりません。
      </Text>
      <Text size="xs" c="dimmed">
        有効な間は、認証を通った閲覧者の画像や CSS のリクエストも Worker
        を通るため、Workers のリクエスト数（無料プランは 1 日 10
        万件）に数えられます。認証を通っていないアクセスは 1 件だけです。
      </Text>
      {user && !editing && (
        <Group gap="sm">
          <Text size="sm">
            ユーザー名: <b>{user}</b>
          </Text>
          <Button size="xs" onClick={() => setEditing(true)}>
            変更する
          </Button>
          <Button
            size="xs"
            variant="subtle"
            color="red"
            onClick={() => setConfirmClear(true)}
          >
            オフにする
          </Button>
        </Group>
      )}
      {showForm && (
        <form onSubmit={save}>
          <Stack gap="sm" maw={360}>
            <TextInput
              label="ユーザー名"
              value={name}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
            />
            <PasswordInput
              label={user ? "新しいパスワード" : "パスワード"}
              description="8 文字以上。閲覧者に伝えるので、ほかで使っていないものにしてください。"
              value={password}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
            />
            <Group gap="sm">
              <Button
                type="submit"
                variant="filled"
                loading={busy}
                disabled={!name.trim() || !password}
              >
                {user ? "変更する" : "設定する"}
              </Button>
              {editing && (
                <Button
                  variant="default"
                  onClick={() => {
                    setEditing(false);
                    setName(user ?? "");
                    setPassword("");
                    setError(null);
                  }}
                >
                  やめる
                </Button>
              )}
            </Group>
          </Stack>
        </form>
      )}
      {error && (
        <MessageText size="sm" error>
          {error}
        </MessageText>
      )}
      {confirmClear && (
        <ConfirmDialog
          title="Basic 認証をオフにしますか？"
          confirmLabel="オフにする"
          danger
          onConfirm={async () => {
            await clearBasicAuth();
            setUser(null);
            setName("");
            notifyPublishStatusChange();
            toast("Basic 認証をオフにしました", {
              description: "サイトに反映されるのは次の公開からです",
            });
          }}
          onClose={() => setConfirmClear(false)}
        >
          <Text size="sm">
            次に公開したときから、サイトを誰でも見られるようになります。
          </Text>
        </ConfirmDialog>
      )}
    </Card>
  );
}
