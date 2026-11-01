import { useEffect, useState } from "react";
import {
  D1Database,
  SITE_ID_PATTERN,
  SitesState,
  connectCandidates,
  connectSite,
  createSite,
  resourceNames,
} from "./lib/sites";
import { Box, Button, Code, Input, Paper, SegmentedControl, Text, TextInput } from "@mantine/core";
import { Alert } from "./ui/Alert";
import { Card } from "./ui/Card";
import { Menu } from "./ui/Menu";
import { PageHeader } from "./ui/PageHeader";

type Props = { onDone: (s: SitesState) => void; onCancel?: () => void };

export function SiteSetup({ onDone, onCancel }: Props) {
  const [mode, setMode] = useState<"create" | "connect">("create");
  return (
    <div className="setup">
      <PageHeader title="サイトを追加">{onCancel && <Button onClick={onCancel}>キャンセル</Button>}</PageHeader>
      <SegmentedControl
        value={mode}
        onChange={(v) => setMode(v as "create" | "connect")}
        data={[
          { value: "create", label: "新しく作る" },
          { value: "connect", label: "既存のサイトに接続" },
        ]}
        className="mode-switch"
        style={{ alignSelf: "flex-start" }}
      />
      {mode === "create" ? <CreateForm onDone={onDone} /> : <ConnectForm onDone={onDone} />}
    </div>
  );
}

function CreateForm({ onDone }: Props) {
  const [title, setTitle] = useState("");
  const [siteId, setSiteId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idValid = SITE_ID_PATTERN.test(siteId);
  const names = resourceNames(siteId || "…");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await createSite(siteId, title));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="新しいサイトを作る" description="Cloudflare に、このサイト用の D1 データベースと R2 バケットを作ります。" onSubmit={submit}>
      <TextInput
        label="サイト名"
        description="サイトのタイトルとして表示されます。日本語も使えます。"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="例: 〇〇のブログ"
        autoFocus
      />
      <TextInput
        label="サイト ID"
        description="英小文字で始まる 2〜32 文字の英小文字・数字・ハイフン。Cloudflare のリソース名に使われ、後から変更できません。"
        value={siteId}
        onChange={(e) => setSiteId(e.target.value.toLowerCase())}
        placeholder="例: myblog"
        spellCheck={false}
        error={siteId && !idValid ? "この形式では使えません" : undefined}
      />
      <Paper withBorder radius="md" p="sm" bg="var(--surface-2)">
        <dl className="media-facts">
          <dt>D1 データベース</dt>
          <dd>
            <Code>{names.d1}</Code>
          </dd>
          <dt>R2 バケット</dt>
          <dd>
            <Code>{names.r2}</Code>
          </dd>
          <dt>Worker（初回公開時に作成）</dt>
          <dd>
            <Code>{names.worker}</Code>
          </dd>
        </dl>
      </Paper>
      {error && <Alert level="error">{error}</Alert>}
      <div>
        <Button type="submit" variant="filled" loading={busy} disabled={!idValid || !title.trim()}>
          作成する
        </Button>
      </div>
    </Card>
  );
}

function ConnectForm({ onDone }: Props) {
  const [candidates, setCandidates] = useState<D1Database[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    connectCandidates()
      .then((list) => {
        setCandidates(list);
        // Sites created by this app are prefixed with zwa-.
        setSelected(list.find((d) => d.name.startsWith("zwa-"))?.uuid ?? list[0]?.uuid ?? "");
      })
      .catch((err) => setError(String(err)));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await connectSite(selected));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="既存のサイトに接続"
      description="別の PC で作ったサイトなど、この PC にまだ登録されていないサイトを追加します。"
      onSubmit={submit}
    >
      {candidates === null && !error && <Text c="dimmed">読み込み中…</Text>}
      {candidates?.length === 0 && (
        <Text size="sm" c="dimmed">
          接続できるデータベースがありません。
        </Text>
      )}
      {candidates && candidates.length > 0 && (
        <Input.Wrapper label="D1 データベース" description="このアプリで作ったサイトは zwa- で始まります。">
          <Box mt={6}>
            <Menu
              label={candidates.find((d) => d.uuid === selected)?.name ?? "選択してください"}
              items={candidates.map((d) => ({
                key: d.uuid,
                label: d.name,
                checked: d.uuid === selected,
                onSelect: () => setSelected(d.uuid),
              }))}
            />
          </Box>
        </Input.Wrapper>
      )}
      {error && <Alert level="error">{error}</Alert>}
      <div>
        <Button type="submit" variant="filled" loading={busy} disabled={!selected}>
          接続する
        </Button>
      </div>
    </Card>
  );
}
