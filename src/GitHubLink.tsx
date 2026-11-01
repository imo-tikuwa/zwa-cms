import { Fragment, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Badge, Button, Code, Group, List, Paper, PasswordInput, Stack, Stepper, Text, TextInput } from "@mantine/core";
import { CalendarClock, ExternalLink, Globe, KeyRound, Timer, Workflow } from "lucide-react";
import { Flow } from "./ui/Flow";
import { GuideImage } from "./ui/GuideImage";
import cloudflareTokenImage from "./assets/guide/cloudflare-token-github.png";
import {
  GitHubStatus,
  TEMPLATE_REPO,
  TOKENS_PAGE,
  TOKENS_PERMISSION,
  githubCheckToken,
  githubLink,
  githubStatus,
  githubUnlink,
  newRepoUrl,
  tokenName,
  tokenUrl,
} from "./lib/github";
import { TOKEN_PAGE } from "./lib/auth";
import { formatDate } from "./lib/posts";
import { Alert } from "./ui/Alert";
import { Card } from "./ui/Card";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { Menu } from "./ui/Menu";
import { CopyButton, MessageText } from "./ui/CopyButton";
import { toast } from "./ui/Toast";

/** The "GitHub" section of the site info screen. */
export function GitHubLink({ siteId, onChange }: { siteId: string; onChange: (s: GitHubStatus) => void }) {
  const [status, setStatusState] = useState<GitHubStatus | null>(null);
  const setStatus = (s: GitHubStatus) => {
    setStatusState(s);
    onChange(s);
  };
  const [error, setError] = useState<string | null>(null);

  const load = () => githubStatus().then(setStatus, (e) => setError(String(e)));
  const retry = () =>
    githubStatus().then(
      (s) => {
        setStatus(s);
        if (s.can_make_tokens === false) {
          toast("まだ権限が足りません", { level: "error", description: `${TOKENS_PERMISSION} を追加して保存したか確認してください` });
        }
      },
      (e) => toast("確認できませんでした", { level: "error", description: String(e) }),
    );
  useEffect(() => {
    load();
  }, []);

  if (!status) return error ? <Alert level="error">{error}</Alert> : <Text c="dimmed">読み込み中…</Text>;
  // A repository without the scheduler is a link made by an older version: set it up again.
  const linked = status.repo !== null && status.schedule !== null;
  return (
    <>
      <Card title="GitHub 連携" actions={linked && <Badge variant="light">予約投稿あり</Badge>}>
        <List size="sm" c="dimmed" spacing={4}>
          <List.Item>連携すると、予約投稿（公開日時を過ぎたら自動でサイトに公開）が使えるようになります。</List.Item>
          <List.Item>テーマは連携しても変わらず、「テーマ」画面で管理します。</List.Item>
        </List>
        <Alert level="warning" copy={false}>
          連携しなくてもサイトの公開は可能です。
          <br />
          ただし GitHub 連携を行わない場合は、予約投稿の機能は使えません。
        </Alert>
        <FlowDiagram />
        <TokenNote />
      </Card>
      {status.can_make_tokens === false ? (
        <CloudflarePermission onRetry={retry} />
      ) : (
        !linked && <SetupSteps siteId={siteId} status={status} onDone={setStatus} />
      )}
      {linked && <LinkedCard status={status} onDone={setStatus} />}
    </>
  );
}

/** How a scheduled post reaches the site. */
function FlowDiagram() {
  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        予約投稿の流れ
      </Text>
      <Flow
        steps={[
          { icon: <CalendarClock size={22} />, title: "公開日時を過ぎる", sub: "予約した記事" },
          { icon: <Timer size={22} />, title: "予約用の Worker", sub: "5 分ごとに D1 を確認" },
          { icon: <Workflow size={22} />, title: "GitHub Actions", sub: "サイトを作って公開", accent: true },
          { icon: <Globe size={22} />, title: "サイトに載る", sub: "予約の時刻から数分後" },
        ]}
      />
    </Stack>
  );
}

/** What GitHub gets and what the one token can do. */
function TokenNote() {
  return (
    <Paper withBorder radius="md" p="sm">
      <Group gap={8} mb={6} wrap="nowrap">
        <span className="flow-icon">
          <KeyRound size={18} />
        </span>
        <Text size="sm" fw={600}>
          GitHub で行うこと
        </Text>
      </Group>
      <List size="xs" c="dimmed" spacing={2}>
        <List.Item>テンプレートからリポジトリを作ります（中身は公開のワークフローと README だけです）</List.Item>
        <List.Item>そのリポジトリだけを対象にしたトークンを 1 つ作ります（期限なし）</List.Item>
        <List.Item>
          アプリはそのトークンでリポジトリのシークレットを設定し、予約用の Worker のシークレットとして保存します（この PC には保存しません）
        </List.Item>
        <List.Item>
          トークンでできるのは、ワークフローの起動とシークレットの上書きだけです。ワークフローの書き換えや、シークレットの読み出しはできません
        </List.Item>
      </List>
    </Paper>
  );
}

/** The link makes a Cloudflare token for Actions, so the user's token must be able to. */
function CloudflarePermission({ onRetry }: { onRetry: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Alert
      level="warning"
      copy={false}
      title="Cloudflare のユーザー API トークンに権限を追加してください"
      actions={
        <>
          <Button size="xs" leftSection={<ExternalLink size={14} />} onClick={() => openUrl(TOKEN_PAGE)}>
            Cloudflare の API トークンの管理画面を開く
          </Button>
          <Button
            size="xs"
            variant="filled"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await onRetry();
              setBusy(false);
            }}
          >
            もう一度確認
          </Button>
        </>
      }
    >
      <p>
        GitHub Actions がサイトを公開するための Cloudflare のトークンを、このアプリが作ります。そのため、このアプリに登録した Cloudflare のユーザー API トークンに次の権限が必要です。
      </p>
      <ol className="steps">
        <li>Cloudflare の API トークンの管理画面で、このアプリに登録したトークンの「Edit」を開きます</li>
        <li>
          <Code>{TOKENS_PERMISSION}</Code>（日本語の画面では「アカウント / API トークン / 編集」）を追加して保存します
          <GuideImage src={cloudflareTokenImage} alt="Cloudflare の API トークンの編集画面" />
        </li>
        <li>「もう一度確認」を押すと、設定の手順が表示されます</li>
      </ol>
    </Alert>
  );
}

/** What the prefilled GitHub token page should show, field by field. */
function TokenFields({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="media-facts token-fields">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function OpenButton({ url, label, filled }: { url: string; label: string; filled?: boolean }) {
  return (
    <div>
      <Button size="xs" variant={filled ? "filled" : "default"} leftSection={<ExternalLink size={14} />} onClick={() => openUrl(url)}>
        {label}
      </Button>
    </div>
  );
}

/** A value to type into GitHub's form, with a copy button. */
function CopyValue({ value }: { value: string }) {
  return (
    <Group gap={4} wrap="nowrap" component="span" style={{ display: "inline-flex" }}>
      <Code>{value}</Code>
      <CopyButton text={() => value} />
    </Group>
  );
}

function ErrorText({ error }: { error: string | null }) {
  return (
    error && (
      <MessageText size="sm" error>
        {error}
      </MessageText>
    )
  );
}

/** The repository from the template, then the token. */
function SetupSteps({ siteId, status, onDone }: { siteId: string; status: GitHubStatus; onDone: (s: GitHubStatus) => void }) {
  const [active, setActive] = useState(0);
  const [name, setName] = useState(status.repo?.split("/").pop() ?? `zwa-${siteId}`);
  return (
    <Card title="設定の手順">
      <Stepper active={active} onStepClick={setActive} size="sm" allowNextStepsSelect={false}>
        <Stepper.Step label="リポジトリ" description="テンプレートから作る">
          <RepoStep name={name} onName={setName} onNext={() => setActive(1)} />
        </Stepper.Step>
        <Stepper.Step label="トークン" description="作って連携する">
          <TokenStep name={name.trim()} status={status} onBack={() => setActive(0)} onDone={onDone} />
        </Stepper.Step>
      </Stepper>
    </Card>
  );
}

const validName = (name: string) => /^[A-Za-z0-9._-]+$/.test(name);

function RepoStep({ name, onName, onNext }: { name: string; onName: (name: string) => void; onNext: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const check = (next: () => void) => {
    if (!validName(name.trim())) {
      setError("リポジトリ名は英数字・ハイフン・アンダースコア・ピリオドで入力してください");
      return;
    }
    setError(null);
    next();
  };
  return (
    <Stack gap="md" mt="md">
      <TextInput
        label="リポジトリ名"
        description="GitHub に作るリポジトリの名前です。"
        value={name}
        onChange={(e) => onName(e.target.value)}
        error={error}
        spellCheck={false}
      />
      <ol className="steps">
        <li>
          下のボタンで、テンプレートからリポジトリを作るページを開きます
          <Group gap="xs">
            <Button size="xs" leftSection={<ExternalLink size={14} />} onClick={() => check(() => openUrl(newRepoUrl(name.trim())))}>
              テンプレートからリポジトリを作る
            </Button>
            <Button size="xs" variant="subtle" color="gray" onClick={() => openUrl(`https://github.com/${TEMPLATE_REPO}`)}>
              テンプレートを見る
            </Button>
          </Group>
        </li>
        <li>
          開いたページが次のとおりになっていることを確認して、「Create repository」を押します
          <TokenFields
            rows={[
              ["Start with a template", <Code>{TEMPLATE_REPO}</Code>],
              ["Include all branches", "Off のまま"],
              ["Owner", "自分のアカウント"],
              ["Repository name", <CopyValue value={name.trim()} />],
              ["Description", "空欄のままで構いません"],
              ["Choose visibility", "Private（Public でも構いません。中身はワークフローと README だけで、記事やトークンは入りません）"],
            ]}
          />
        </li>
        <li>リポジトリができたら「次へ」を押します</li>
      </ol>
      <div>
        <Button variant="filled" onClick={() => check(onNext)}>
          次へ
        </Button>
      </div>
    </Stack>
  );
}

function TokenStep({
  name,
  status,
  onBack,
  onDone,
}: {
  name: string;
  status: GitHubStatus;
  onBack: () => void;
  onDone: (s: GitHubStatus) => void;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the token expires: shown, then the next press goes ahead.
  const [expires, setExpires] = useState<string | null>(null);

  const link = async () => {
    if (!token.trim()) {
      setError("作ったトークンを貼り付けてください");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!expires) {
        const c = await githubCheckToken(token);
        if (!c.fine_grained) {
          setError("fine-grained のトークンではありません。上のボタンから作り直してください（Tokens (classic) は使えません）。");
          return;
        }
        if (c.expires_at) {
          setExpires(c.expires_at);
          return;
        }
      }
      onDone(await githubLink(token, name));
      toast("GitHub と連携しました");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="md" mt="md">
      {!status.published && (
        <Alert level="info" compact>
          このサイトはまだ一度も公開していません。連携はできますが、予約投稿は最初の「サイトに公開」の後から動きます（予約投稿の仕組みが勝手にサイトを初公開しないように）。
        </Alert>
      )}
      <ol className="steps">
        <li>
          下のボタンで GitHub のトークン作成ページを開きます
          <OpenButton url={tokenUrl(name)} label="トークンを作る" />
        </li>
        <li>
          開いたページが次のとおりになっていることを確認して、「Generate token」を押します。名前・期限・権限は入力済みで、自分で選ぶのは Repository access だけです
          <TokenFields
            rows={[
              ["Token name", <CopyValue value={tokenName(name)} />],
              ["Expiration", "No expiration（GitHub の黄色い注意が出ますが、期限が切れると予約投稿が止まるため期限なしにします）"],
              [
                "Repository access",
                <>
                  <b>Only select repositories</b> で <CopyValue value={name} /> だけを選ぶ（ここだけ選ぶ）
                </>,
              ],
              ["Permissions", <><Code>Actions</Code> と <Code>Secrets</Code> が Read and write（<Code>Metadata</Code> の Read-only は自動で付きます）</>],
            ]}
          />
          確認のダイアログが出たら、もう一度「Generate token」を押します
        </li>
        <li>表示されたトークンをコピーして、下に貼り付けて「連携する」を押します</li>
      </ol>
      <PasswordInput
        label="トークン"
        description="シークレットの設定に使い、予約用の Worker に保存します。"
        value={token}
        onChange={(e) => {
          setToken(e.target.value);
          setExpires(null);
        }}
        autoComplete="off"
        spellCheck={false}
      />
      {expires && (
        <Alert level="warning" compact copy={false}>
          このトークンには期限があります（{expires}）。期限が切れると予約投稿が止まります。期限なし（No expiration）で作り直すか、このまま「連携する」を押してください。
        </Alert>
      )}
      <ErrorText error={error} />
      <Group gap="sm">
        <Button onClick={onBack} disabled={busy}>
          戻る
        </Button>
        <Button variant="filled" loading={busy} onClick={link}>
          連携する
        </Button>
      </Group>
    </Stack>
  );
}

function LinkedCard({ status, onDone }: { status: GitHubStatus; onDone: (s: GitHubStatus) => void }) {
  const [confirm, setConfirm] = useState(false);
  const repoUrl = `https://github.com/${status.repo}`;
  return (
    <Card
      title="リポジトリ"
      actions={
        <Menu
          label="GitHub で開く"
          icon={<ExternalLink size={14} />}
          fullWidth={false}
          items={[
            { key: "repo", label: "リポジトリ", onSelect: () => openUrl(repoUrl) },
            { key: "actions", label: "Actions（ワークフローの実行履歴）", onSelect: () => openUrl(`${repoUrl}/actions`) },
            { key: "secrets", label: "シークレット", onSelect: () => openUrl(`${repoUrl}/settings/secrets/actions`) },
          ]}
        />
      }
    >
      <dl className="media-facts">
        <dt>リポジトリ</dt>
        <dd>
          <Code>{status.repo}</Code>
        </dd>
        <dt>予約投稿</dt>
        <dd>
          有効（5 分ごとに確認）
          {!status.published && "。最初の「サイトに公開」の後から動きます"}
        </dd>
        {status.dispatched_at && (
          <>
            <dt>最後の自動公開</dt>
            <dd>{formatDate(status.dispatched_at)} に GitHub Actions を起動（結果は Actions の画面で確認できます）</dd>
          </>
        )}
      </dl>
      {status.dispatch_error && (
        <Alert level="error" title="予約投稿の公開を始められませんでした">
          {status.dispatch_error}
        </Alert>
      )}
      <Text size="xs" c="dimmed">
        トークンを作り直したときは、連携を解除してからもう一度連携します。
      </Text>
      <Group gap="sm">
        <Button variant="subtle" color="red" onClick={() => setConfirm(true)}>
          連携を解除
        </Button>
        <Text size="xs" c="dimmed">
          GitHub のリポジトリとトークンは消えません。
        </Text>
      </Group>
      {confirm && (
        <ConfirmDialog
          title="GitHub 連携を解除しますか？"
          confirmLabel="解除する"
          danger
          onConfirm={async () => {
            onDone(await githubUnlink());
            toast("GitHub 連携を解除しました", {
              description: "不要なら、GitHub でリポジトリとトークンを削除してください",
            });
          }}
          onClose={() => setConfirm(false)}
        >
          <Text size="sm">
            予約用の Worker と、GitHub Actions 用の Cloudflare トークンを削除します。予約中の記事は自動では載らなくなり、日時を過ぎた後の「サイトに公開」で載ります。
          </Text>
          <Text size="sm">
            GitHub のリポジトリとトークン（{tokenName(status.repo ?? "")}）は残ります。不要なら GitHub で削除してください。
          </Text>
          <OpenButton url={TOKENS_PAGE} label="GitHub のトークンの一覧を開く" />
        </ConfirmDialog>
      )}
    </Card>
  );
}
