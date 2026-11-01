import { Suspense, lazy, useEffect, useState } from "react";
import { ArrowRightLeft, Cloud, GitBranch, Globe, Inbox, Info, Link2, Lock, Trash2, Unlink, Users } from "lucide-react";
import { Site, SitesState, deleteSite } from "./lib/sites";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { Button, Code, Group, Select, Stack, Switch, Text, TextInput, Textarea } from "@mantine/core";
import { Choice, DEFAULT_LANGUAGE, DEFAULT_OFFSET, LANGUAGE_CHOICES, OFFSET_CHOICES, withCurrent } from "./lib/locale";
import { Alert } from "./ui/Alert";
import { toast } from "./ui/Toast";
import { Card } from "./ui/Card";
import { Section, SectionLayout } from "./ui/SectionLayout";
import { SiteSettings, getSiteSettings, saveSiteSettings } from "./lib/siteSettings";
import { TermPanel } from "./Terms";
import { Redirects } from "./Redirects";
import { FormsFeatureCard } from "./Forms";
import { BasicAuthCard } from "./BasicAuth";
import { GitHubLink } from "./GitHubLink";
import { GitHubStatus } from "./lib/github";
import { MessageText } from "./ui/CopyButton";

// Development tools in src/dev/, which the public repository does not have
// (the glob is then empty). Left out of release builds.
const devTools = import.meta.env.DEV
  ? import.meta.glob<{ DemoSeedCard: () => React.JSX.Element }>("./dev/DemoSeed.tsx")
  : {};
const loadDemoSeed = Object.values(devTools)[0];
const DemoSeedCard = loadDemoSeed && lazy(() => loadDemoSeed().then((m) => ({ default: m.DemoSeedCard })));

type Field = {
  key: string;
  label: string;
  placeholder?: string;
  help?: string;
  multiline?: boolean;
  toggle?: { on: string; off: string };
  /** A fixed list; `fallback` is what the generator uses when unset. */
  choices?: { options: Choice[]; fallback: string };
  /** Card the field belongs to. */
  group: "basic" | "url" | "region";
};

const FIELDS: Field[] = [
  { key: "site.title", label: "サイト名", group: "basic" },
  {
    key: "site.description",
    label: "サイトの説明",
    multiline: true,
    group: "basic",
    help: "検索結果や SNS で表示されるサイトの紹介文です。",
  },
  {
    key: "site.url",
    label: "サイトの URL",
    placeholder: "https://example.com",
    help: "独自ドメインなど、サイトを公開している URL です。sitemap.xml・RSS・canonical に使います。空欄なら公開先の workers.dev の URL を使います。",
    group: "basic",
  },
  {
    key: "permalink.post",
    label: "記事のパーマリンク",
    placeholder: "/posts/{slug}/",
    help: "記事の URL の形です。{slug} {id} {year} {month} {day} が使えます。例: /{year}/{month}/{slug}/",
    group: "url",
  },
  {
    key: "site.posts_per_page",
    label: "1 ページあたりの記事数",
    placeholder: "10",
    help: "トップページなどの記事一覧に並べる数です。",
    group: "url",
  },
  {
    key: "site.image_max_width",
    label: "画像の最大幅（px）",
    placeholder: "1600",
    help: "これより幅の広い JPEG・PNG は、公開時に縮小します（R2 の元画像はそのままです）。",
    group: "url",
  },
  {
    key: "site.search",
    label: "サイト内検索を使う",
    help: "オフにすると、検索ページ（/search/）と検索用の索引を出力せず、サイトが軽くなります。",
    toggle: { on: "", off: "off" },
    group: "url",
  },
  {
    key: "site.utc_offset",
    label: "タイムゾーン",
    help: "日付の表示と、記事の URL の日付に使います。夏時間のある地域は、夏時間でない時期（標準時）の時差を載せています。夏時間には自動で切り替わりません。",
    group: "region",
    choices: { options: OFFSET_CHOICES, fallback: DEFAULT_OFFSET },
  },
  {
    key: "site.language",
    label: "言語",
    help: "サイトの HTML に書く言語（lang 属性）です。ブラウザの読み上げや翻訳、検索エンジンが参考にします。",
    group: "region",
    choices: { options: LANGUAGE_CHOICES, fallback: DEFAULT_LANGUAGE },
  },
];

const GROUPS = [
  { key: "basic", title: "基本情報" },
  { key: "url", title: "URL と表示" },
  { key: "region", title: "地域と言語" },
] as const;

export type SiteSection = Field["group"] | "forms" | "auth" | "authors" | "redirects" | "github" | "cloudflare";

const SECTIONS: Section<SiteSection>[] = [
  { key: "basic", label: "基本情報", icon: <Info size={16} /> },
  { key: "url", label: "URL と表示", icon: <Link2 size={16} /> },
  { key: "region", label: "地域と言語", icon: <Globe size={16} /> },
  { key: "forms", label: "問い合わせフォーム", icon: <Inbox size={16} /> },
  { key: "auth", label: "Basic 認証", icon: <Lock size={16} /> },
  { key: "authors", label: "著者", icon: <Users size={16} /> },
  { key: "redirects", label: "リダイレクト", icon: <ArrowRightLeft size={16} /> },
  { key: "github", label: "GitHub 連携", icon: <GitBranch size={16} /> },
  { key: "cloudflare", label: "Cloudflare", icon: <Cloud size={16} /> },
];

type Props = {
  site: Site;
  onTitleChange: (title: string) => void;
  onForget: () => void;
  /** The site was deleted from Cloudflare (and from this PC's list). */
  onDeleted: (state: SitesState) => void;
  /** Contact forms were turned on or off (the sidebar shows them only when on). */
  onFormsChange: (enabled: boolean) => void;
  /** The GitHub link changed (scheduled posts on or off). */
  onGitHubChange: (status: GitHubStatus) => void;
  /** The section to open with. */
  initialSection?: SiteSection;
};

export function SiteInfo({ site, onTitleChange, onForget, onDeleted, onFormsChange, onGitHubChange, initialSection }: Props) {
  const [values, setValues] = useState<SiteSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [section, setSection] = useState<SiteSection>(initialSection ?? "basic");
  const [deleting, setDeleting] = useState(false);
  const [typedId, setTypedId] = useState("");

  useEffect(() => {
    getSiteSettings()
      .then(setValues)
      .catch((err) => setMessage({ error: true, text: String(err) }));
  }, [site.d1_database_id]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!values) return;
    setBusy(true);
    setMessage(null);
    try {
      // Send every field so clearing one removes the setting.
      const all = Object.fromEntries(FIELDS.map((f) => [f.key, values[f.key] ?? ""]));
      await saveSiteSettings(all);
      onTitleChange(all["site.title"]);
      toast("サイト情報を保存しました");
    } catch (err) {
      setMessage({ error: true, text: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const field = (f: Field) => {
    if (!values) return null;
    const set = (v: string) => setValues({ ...values, [f.key]: v });
    if (f.toggle) {
      return (
        <Switch
          key={f.key}
          label={f.label}
          description={f.help}
          checked={(values[f.key] ?? "") !== f.toggle.off}
          onChange={(e) => set(e.currentTarget.checked ? f.toggle!.on : f.toggle!.off)}
        />
      );
    }
    if (f.choices) {
      return (
        <Select
          key={f.key}
          label={f.label}
          description={f.help}
          data={withCurrent(f.choices.options, values[f.key])}
          value={values[f.key] || f.choices.fallback}
          onChange={(v) => v && set(v)}
          allowDeselect={false}
          searchable
          nothingFoundMessage="見つかりません"
          maxDropdownHeight={320}
          comboboxProps={{ withinPortal: true }}
        />
      );
    }
    const common = { label: f.label, description: f.help, placeholder: f.placeholder, value: values[f.key] ?? "" };
    return f.multiline ? (
      <Textarea key={f.key} {...common} autosize minRows={2} onChange={(e) => set(e.target.value)} />
    ) : (
      <TextInput key={f.key} {...common} spellCheck={false} onChange={(e) => set(e.target.value)} />
    );
  };

  const group = GROUPS.find((g) => g.key === section);
  return (
    <SectionLayout
      title="サイト情報"
      description="このサイトの設定です。サイトごとに保存され、どの PC からも同じ設定が使われます。"
      sections={SECTIONS}
      active={section}
      onSelect={setSection}
      notice={!values && message && <Alert level="error">{message.text}</Alert>}
    >
      {group && values && (
        // The three groups share one form: unsaved edits survive switching between them.
        <form onSubmit={save}>
          <Stack gap="lg">
            <Card title={group.title}>{FIELDS.filter((f) => f.group === group.key).map(field)}</Card>
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
          </Stack>
        </form>
      )}
      {section === "forms" && <FormsFeatureCard onChange={onFormsChange} />}
      {section === "auth" && <BasicAuthCard />}
      {section === "authors" && (
        <Card>
          <TermPanel kind="author" />
        </Card>
      )}
      {section === "redirects" && (
        <Card>
          <Redirects />
        </Card>
      )}
      {section === "github" && <GitHubLink siteId={site.id} onChange={onGitHubChange} />}
      {section === "cloudflare" && (
        <>
          <Card
            title="Cloudflare のリソース"
            description="このサイトのデータの保存先です。名前はサイト ID から決まり、変更できません。"
          >
            <dl className="media-facts">
              <dt>サイト ID</dt>
              <dd>
                <Code>{site.id}</Code>
              </dd>
              <dt>D1 データベース</dt>
              <dd>
                <Code>{site.d1_database_name}</Code>
              </dd>
              <dt>R2 バケット</dt>
              <dd>
                <Code>{site.r2_bucket}</Code>
              </dd>
              <dt>Worker</dt>
              <dd>
                <Code>{site.worker_name}</Code>
              </dd>
            </dl>
          </Card>
          <Card
            title="この PC の一覧から外す"
            description="この PC のサイト一覧から外します。Cloudflare 上のデータ（D1・R2・Worker）は残り、「既存のサイトに接続」で再び追加できます。"
          >
            <div>
              <Button leftSection={<Unlink size={16} />} onClick={onForget}>
                一覧から外す
              </Button>
            </div>
          </Card>
          <Card
            title="サイトを削除"
            description="このサイトのために作った Cloudflare のリソースをすべて削除します。記事・画像・テーマ・受信した問い合わせも消え、元に戻せません。"
          >
            <div>
              <Button
                color="red"
                variant="light"
                leftSection={<Trash2 size={16} />}
                onClick={() => {
                  setTypedId("");
                  setDeleting(true);
                }}
              >
                サイトを削除
              </Button>
            </div>
          </Card>
          {DemoSeedCard && (
            <Suspense fallback={null}>
              <DemoSeedCard />
            </Suspense>
          )}
          {deleting && (
            <ConfirmDialog
              title={`「${site.title}」を削除しますか？`}
              confirmLabel="削除する"
              danger
              confirmDisabled={typedId !== site.id}
              onConfirm={async () => {
                const { state, warnings } = await deleteSite(site.id);
                toast(`「${site.title}」を削除しました`, {
                  level: warnings.length ? "error" : "success",
                  description: warnings.join("\n") || undefined,
                });
                onDeleted(state);
              }}
              onClose={() => setDeleting(false)}
            >
              <Text size="sm">次のものを削除します。元に戻せません。</Text>
              <ul className="steps">
                <li>
                  Worker <Code>{site.worker_name}</Code>（公開中のサイト）
                </li>
                <li>
                  R2 バケット <Code>{site.r2_bucket}</Code>（画像・テーマ）
                </li>
                <li>
                  D1 データベース <Code>{site.d1_database_name}</Code>（記事・設定・受信した問い合わせ）
                </li>
                <li>GitHub 連携の予約用 Worker と Actions 用のトークン、問い合わせフォームの Turnstile のウィジェット</li>
              </ul>
              <Text size="sm">GitHub のリポジトリとトークンは残ります。不要なら GitHub で削除してください。</Text>
              <TextInput
                mt="sm"
                label={
                  <>
                    確認のため、サイト ID <Code>{site.id}</Code> を入力してください
                  </>
                }
                value={typedId}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => setTypedId(e.target.value)}
              />
            </ConfirmDialog>
          )}
        </>
      )}
    </SectionLayout>
  );
}
