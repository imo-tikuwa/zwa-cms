import { useEffect, useRef, useState } from "react";
import {
  Building2,
  FileText,
  Files,
  FolderTree,
  Globe,
  Image as ImageIcon,
  Inbox,
  LogOut,
  Palette,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";
import { AuthStatus, authStatus, selectAccount, signOut } from "./lib/auth";
import { PostType } from "./lib/posts";
import { SitesState, forgetSite, migrateSite, selectSite, sitesState } from "./lib/sites";
import { aiStatus } from "./lib/ai";
import { quitApp } from "./lib/app";
import { busyLabels, useBusy } from "./lib/busy";
import { lockStatus, onLockChange } from "./lib/lock";
import { formsStatus, pollSubmissions } from "./lib/forms";
import { listen } from "@tauri-apps/api/event";
import { PostEditor } from "./PostEditor";
import { PreviewControl, PreviewHandle } from "./PreviewControl";
import { SidebarResizer, useSidebarWidth } from "./ui/SidebarResizer";
import { PublishControl } from "./PublishControl";
import { PUBLISHING } from "./lib/preview";
import { PostList } from "./PostList";
import { MediaLibrary } from "./MediaLibrary";
import { SignIn } from "./SignIn";
import { SiteInfo, SiteSection } from "./SiteInfo";
import { Terms } from "./Terms";
import { AiScreen } from "./AiScreen";
import { Forms } from "./Forms";
import { AppSettings, AppSettingsSection } from "./AppSettings";
import { ThemeScreen } from "./ThemeScreen";
import { SiteSetup } from "./SiteSetup";
import { Badge, Button, Group, NavLink, Paper, Stack, Text, Title } from "@mantine/core";
import { Alert } from "./ui/Alert";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { Menu } from "./ui/Menu";
import { TitleBar } from "./ui/TitleBar";
import { dismissNotice, noticeDismissed } from "./lib/notice";
import { githubStatus } from "./lib/github";
import "./styles.css";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; auth: AuthStatus; sites: SitesState };

type View =
  // This PC's settings (title bar gear), independent of the site.
  | { kind: "app"; section: AppSettingsSection }
  | { kind: "site"; section?: SiteSection }
  | { kind: "terms" }
  | { kind: "media" }
  | { kind: "theme" }
  | { kind: "ai" }
  | { kind: "forms" }
  | { kind: "list"; type: PostType }
  // id null = new post
  | { kind: "edit"; type: PostType; id: number | null; formId?: number };

export default function App() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [adding, setAdding] = useState(false);
  // Switching the site or account mid-publish would mix up whose site is sent.
  const publishing = useBusy(PUBLISHING);
  const [view, setViewState] = useState<View>({ kind: "list", type: "post" });
  const [dirty, setDirty] = useState(false);
  const preview = useRef<PreviewHandle>(null);
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth();
  /** Path of the post being edited, for the preview button. */
  const [editingPath, setEditingPath] = useState<string | null>(null);
  // Navigation waiting for the user to discard unsaved edits.
  const [pending, setPending] = useState<(() => void) | null>(null);

  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [keyNoticeHidden, setKeyNoticeHidden] = useState(keyNoticeDismissed);
  // Windows Hello is available but the lock is off: suggest turning it on.
  const [suggestLock, setSuggestLock] = useState(false);
  const [lockNoticeHidden, setLockNoticeHidden] = useState(() => noticeDismissed(LOCK_NOTICE));
  useEffect(() => {
    const check = () =>
      void lockStatus()
        .then((s) => setSuggestLock(s.supported && !s.enabled))
        .catch(() => {});
    check();
    return onLockChange(check);
  }, []);
  // What quitting would interrupt, while asking (quit-on-close mode).
  const [quitReasons, setQuitReasons] = useState<string[] | null>(null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const guard = (go: () => void) => (dirty ? setPending(() => go) : go());
  const setView = (v: View) => guard(() => setViewState(v));

  const load = () => {
    setState({ kind: "loading" });
    authStatus()
      .then(async (auth) => setState({ kind: "ready", auth, sites: await sitesState() }))
      .catch((err) => setState({ kind: "error", message: String(err) }));
  };

  useEffect(load, []);
  useEffect(() => {
    aiStatus()
      .then((s) => setHasKey(s.has_key))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Sent only when the app is set to quit on close (src-tauri/src/tray.rs).
    const off = listen("close-requested", () => {
      const reasons = [...busyLabels(), ...(dirtyRef.current ? ["保存していない変更"] : [])];
      if (reasons.length) setQuitReasons(reasons);
      else void quitApp();
    });
    return () => void off.then((f) => f());
  }, []);

  const currentSite = state.kind === "ready" ? state.sites.current_site : null;
  // Scheduled posts are on (GitHub link). null while unknown.
  const [scheduling, setScheduling] = useState<boolean | null>(null);
  useEffect(() => {
    setScheduling(null);
    if (!currentSite) return;
    githubStatus().then(
      (s) => setScheduling(s.schedule !== null),
      () => setScheduling(null),
    );
  }, [currentSite]);
  // Unread contact form submissions, polled while forms are on.
  const [unread, setUnread] = useState(0);
  const [formsEnabled, setFormsEnabled] = useState(false);
  /** Set briefly after forms are turned on, to draw the eye to the new menu item. */
  const [formsJustEnabled, setFormsJustEnabled] = useState(false);
  const [inboxVersion, setInboxVersion] = useState(0);
  const seenSubmission = useRef<number | null>(null);
  useEffect(() => {
    setUnread(0);
    seenSubmission.current = null;
    if (!currentSite) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const inbox = await pollSubmissions(seenSubmission.current);
        if (stopped) return;
        seenSubmission.current = inbox.latest_id ?? 0;
        setUnread(inbox.unread);
      } catch {
        // Try again on the next round.
      }
    };
    // A failure here shows up again on the screens that read D1.
    migrateSite()
      .catch(() => {})
      .then(() => formsStatus())
      .then(async (s) => {
        if (stopped) return;
        setFormsEnabled(s.enabled);
        if (!s.enabled) return;
        await poll();
        timer = window.setInterval(poll, 5 * 60 * 1000);
      })
      .catch(() => {});
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [currentSite, inboxVersion]);

  if (state.kind === "loading") {
    return (
      <div className="app">
        <TitleBar />
        <main className="center muted">読み込み中…</main>
      </div>
    );
  }
  if (state.kind === "error") {
    // e.g. the saved token was revoked, or the network is down.
    return (
      <div className="app">
        <TitleBar />
        <main className="center">
          <Paper withBorder radius="md" p="xl" shadow="sm" w="min(560px, 100%)">
            <Stack gap="md">
              <Title order={1} size="h3">
                Cloudflare に接続できません
              </Title>
              <Alert level="error">{state.message}</Alert>
              <Text size="sm" c="dimmed">
                ネットワークの状態を確かめて再試行してください。API トークンを削除・変更した場合は、接続をやり直します。
              </Text>
              <Group gap="sm">
                <Button variant="filled" onClick={load}>
                  再試行
                </Button>
                <Button onClick={() => signOut().then(load)}>接続をやり直す</Button>
              </Group>
            </Stack>
          </Paper>
        </main>
      </div>
    );
  }

  const { auth, sites } = state;
  if (!auth.method) {
    return (
      <div className="app">
        <TitleBar />
        <SignIn onSignedIn={load} />
      </div>
    );
  }

  const setSites = (s: SitesState) => {
    setAdding(false);
    setState({ ...state, sites: s });
  };
  const account = auth.accounts.find((a) => a.id === auth.account_id);
  const site = sites.sites.find((s) => s.d1_database_id === sites.current_site);

  let content;
  if (view.kind === "app") {
    content = (
      <AppSettings onKeyChange={setHasKey} section={view.section} onSection={(section) => setView({ kind: "app", section })} />
    );
  } else if (!account) {
    content = <Text c="dimmed">左下で使う Cloudflare アカウントを選んでください。</Text>;
  } else if (adding || sites.sites.length === 0) {
    content = <SiteSetup onDone={setSites} onCancel={sites.sites.length ? () => setAdding(false) : undefined} />;
  } else if (!site) {
    content = <Text c="dimmed">サイドバーの上でサイトを選んでください。</Text>;
  } else if (view.kind === "ai") {
    content = (
      <AiScreen key={site.d1_database_id} hasKey={hasKey} onOpenAppSettings={() => setView({ kind: "app", section: "ai" })} />
    );
  } else if (view.kind === "forms") {
    content = (
      <Forms
        key={site.d1_database_id}
        onCreatePage={(formId) => setView({ kind: "edit", type: "page", id: null, formId })}
        onOpenPage={(id) => setView({ kind: "edit", type: "page", id })}
        onInboxChange={() => setInboxVersion((v) => v + 1)}
        onDirtyChange={setDirty}
      />
    );
  } else if (view.kind === "theme") {
    content = <ThemeScreen key={site.d1_database_id} onChanged={() => preview.current?.refresh()} />;
  } else if (view.kind === "media") {
    content = <MediaLibrary key={site.d1_database_id} />;
  } else if (view.kind === "terms") {
    content = <Terms key={site.d1_database_id} />;
  } else if (view.kind === "list") {
    content = (
      <PostList
        key={site.d1_database_id}
        type={view.type}
        scheduling={scheduling}
        onOpen={(id) => setView({ kind: "edit", type: view.type, id })}
        onOpenGitHub={() => setView({ kind: "site", section: "github" })}
      />
    );
  } else if (view.kind === "edit") {
    content = (
      <PostEditor
        key={`${site.d1_database_id}-${view.type}-${view.id}`}
        type={view.type}
        id={view.id}
        initialFormId={view.formId ?? null}
        scheduling={scheduling}
        onClose={() => setView({ kind: "list", type: view.type })}
        onDirtyChange={setDirty}
        onSaved={() => preview.current?.refresh()}
        onPreviewPath={setEditingPath}
        onPreview={(path) => preview.current?.open(path)}
      />
    );
  } else {
    content = (
      <SiteInfo
        key={view.section ?? ""}
        site={site}
        initialSection={view.section}
        onGitHubChange={(s) => setScheduling(s.schedule !== null)}
        onTitleChange={(title) =>
          setSites({ ...sites, sites: sites.sites.map((x) => (x.d1_database_id === site.d1_database_id ? { ...x, title } : x)) })
        }
        onForget={async () => setSites(await forgetSite(site.d1_database_id))}
        onDeleted={setSites}
        onFormsChange={(enabled) => {
          setFormsEnabled(enabled);
          setInboxVersion((v) => v + 1);
          if (enabled) {
            setFormsJustEnabled(true);
            window.setTimeout(() => setFormsJustEnabled(false), 4000);
          }
        }}
      />
    );
  }

  const navItems = [
    { key: "post", label: "記事", icon: <FileText size={16} />, view: { kind: "list", type: "post" } as View },
    { key: "page", label: "固定ページ", icon: <Files size={16} />, view: { kind: "list", type: "page" } as View },
    { key: "terms", label: "カテゴリー・タグ", icon: <FolderTree size={16} />, view: { kind: "terms" } as View },
    { key: "media", label: "メディア", icon: <ImageIcon size={16} />, view: { kind: "media" } as View },
    { key: "theme", label: "テーマ", icon: <Palette size={16} />, view: { kind: "theme" } as View },
    ...(formsEnabled
      ? [{ key: "forms", label: "問い合わせ", icon: <Inbox size={16} />, view: { kind: "forms" } as View, count: unread }]
      : []),
    { key: "ai", label: "AI", icon: <Sparkles size={16} />, view: { kind: "ai" } as View },
    { key: "site", label: "サイト情報", icon: <Settings size={16} />, view: { kind: "site" } as View },
  ];
  const activeNav = view.kind === "list" || view.kind === "edit" ? view.type : view.kind;

  return (
    <div className="app">
      <TitleBar
        subtitle={site?.title}
        onOpenSettings={() => setView({ kind: "app", section: view.kind === "app" ? view.section : "window" })}
      />
      <div className="shell">
        <aside className="sidebar" style={{ width: sidebarWidth }}>
          {account && sites.sites.length > 0 && (
            <div className="sidebar-section">
              <Menu
                icon={<Globe size={16} />}
                label={adding ? "サイトを追加中…" : (site?.title ?? "サイトを選択")}
                title={publishing ? "公開が終わるまで切り替えられません" : "サイトを切り替え"}
                disabled={publishing}
                items={[
                  ...sites.sites.map((s) => ({
                    key: s.d1_database_id,
                    label: s.title,
                    checked: !adding && s.d1_database_id === sites.current_site,
                    onSelect: () =>
                      guard(async () => {
                        setSites(await selectSite(s.d1_database_id));
                        setViewState({ kind: "list", type: "post" });
                      }),
                  })),
                  { kind: "separator" as const, key: "sep" },
                  { key: "add", label: "サイトを追加", icon: <Plus size={14} />, onSelect: () => guard(() => setAdding(true)) },
                ]}
              />
            </div>
          )}
          <nav className="nav">
            {navItems.map((item) => (
              <NavLink
                key={item.key}
                component="button"
                label={item.label}
                leftSection={item.icon}
                rightSection={
                  item.count ? (
                    <Badge size="sm" circle>
                      {item.count}
                    </Badge>
                  ) : undefined
                }
                active={!adding && activeNav === item.key}
                className={item.key === "forms" && formsJustEnabled ? "nav-new" : undefined}
                disabled={!site || adding}
                onClick={() => setView(item.view)}
              />
            ))}
          </nav>
          <div className="sidebar-bottom">
            {site && !adding && (
              <Stack className="sidebar-section" gap="sm">
                <PreviewControl key={site.d1_database_id} ref={preview} path={view.kind === "edit" ? editingPath : null} />
                <PublishControl key={`publish-${site.d1_database_id}`} />
              </Stack>
            )}
            <div className="sidebar-section">
              <Menu
                up
                icon={<Building2 size={16} />}
                label={account?.name ?? "アカウントを選択"}
                title={publishing ? "公開が終わるまで切り替えられません" : "Cloudflare アカウント"}
                disabled={publishing}
                items={[
                  ...auth.accounts.map((a) => ({
                    key: a.id,
                    label: a.name,
                    checked: a.id === auth.account_id,
                    onSelect: async () => {
                      await selectAccount(a.id);
                      load();
                    },
                  })),
                  { kind: "separator" as const, key: "sep" },
                  {
                    key: "signout",
                    label: "Cloudflare との接続を解除",
                    icon: <LogOut size={14} />,
                    danger: true,
                    onSelect: () => guard(() => void signOut().then(load)),
                  },
                ]}
              />
            </div>
          </div>
        </aside>
        <SidebarResizer width={sidebarWidth} onChange={setSidebarWidth} />
        <main className="content">
          {site && hasKey === false && !keyNoticeHidden && view.kind !== "app" && view.kind !== "ai" && (
            <Alert
              compact
              level="info"
              title="AI 機能を使うには、Claude の API キーを登録します"
              onClose={() => {
                dismissKeyNotice(false);
                setKeyNoticeHidden(true);
              }}
              actions={
                <>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="gray"
                    onClick={() => {
                      dismissKeyNotice(true);
                      setKeyNoticeHidden(true);
                    }}
                  >
                    今後表示しない
                  </Button>
                  <Button size="xs" leftSection={<Settings size={14} />} onClick={() => setView({ kind: "app", section: "ai" })}>
                    API キーを登録する
                  </Button>
                </>
              }
            />
          )}
          {account && suggestLock && !lockNoticeHidden && view.kind !== "app" && (
            <Alert
              compact
              level="info"
              title="Windows Hello でアプリをロックできます"
              onClose={() => {
                dismissNotice(LOCK_NOTICE, false);
                setLockNoticeHidden(true);
              }}
              actions={
                <>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="gray"
                    onClick={() => {
                      dismissNotice(LOCK_NOTICE, true);
                      setLockNoticeHidden(true);
                    }}
                  >
                    今後表示しない
                  </Button>
                  <Button size="xs" leftSection={<Settings size={14} />} onClick={() => setView({ kind: "app", section: "security" })}>
                    設定する
                  </Button>
                </>
              }
            />
          )}
          {content}
          {pending && (
            <ConfirmDialog
              title="保存していない変更があります"
              confirmLabel="変更を破棄して移動"
              cancelLabel="編集に戻る"
              danger
              onConfirm={() => {
                const go = pending;
                setDirty(false);
                go();
              }}
              onClose={() => setPending(null)}
            >
              <Text size="sm">このまま移動すると、編集中の内容は失われます。</Text>
            </ConfirmDialog>
          )}
          {quitReasons && (
            <ConfirmDialog
              title="ZWA CMS を終了しますか？"
              confirmLabel="終了する"
              danger
              onConfirm={quitApp}
              onClose={() => setQuitReasons(null)}
            >
              <p>次の作業が中断されます。</p>
              <ul>
                {quitReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </ConfirmDialog>
          )}
        </main>
      </div>
    </div>
  );
}

const KEY_NOTICE = "zwa.ai.keyNoticeDismissed";
const LOCK_NOTICE = "zwa.lock.noticeDismissed";

const keyNoticeDismissed = () => noticeDismissed(KEY_NOTICE);
const dismissKeyNotice = (forever: boolean) => dismissNotice(KEY_NOTICE, forever);
