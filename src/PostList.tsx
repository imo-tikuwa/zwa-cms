import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, GitBranch, Plus, Search, X } from "lucide-react";
import { dismissNotice, noticeDismissed } from "./lib/notice";
import { PostSummary, PostType, formatDate, listPosts } from "./lib/posts";
import { Button, Group, Paper, Select, Stack, Table, Text, TextInput, UnstyledButton } from "@mantine/core";
import { POST_STATE_LABELS, PostState, postState, usePublishStatus } from "./lib/publishStatus";
import { Category, Tag, categoryTree, listCategories, listTags } from "./lib/taxonomy";
import { PostStateBadge } from "./ui/PostStateBadge";
import { Alert } from "./ui/Alert";
import { Menu } from "./ui/Menu";
import { PageHeader } from "./ui/PageHeader";

type Props = {
  type: PostType;
  /** Scheduled posts are on (GitHub link). null while unknown. */
  scheduling: boolean | null;
  onOpen: (id: number | null) => void;
  onOpenGitHub: () => void;
};

const SCHEDULE_NOTICE = "zwa.github.scheduleNoticeDismissed";

type SortKey = "title" | "published" | "updated";
// "order" is the pages' own order (as loaded).
type Sort = "order" | { key: SortKey; desc: boolean };

// Dates start with the newest, titles from the top of the syllabary.
const FIRST_DESC: Record<SortKey, boolean> = { title: false, published: true, updated: true };

type Filters = { query: string; state: PostState | null; category: number | null; tag: number | null; sort: Sort };

const initialFilters = (type: PostType): Filters => ({
  query: "",
  state: null,
  category: null,
  tag: null,
  sort: type === "page" ? "order" : { key: "published", desc: true },
});

// Kept while the app runs, so coming back from the editor shows the same list.
const remembered = new Map<PostType, Filters>();

export function PostList({ type, scheduling, onOpen, onOpenGitHub }: Props) {
  const [noticeHidden, setNoticeHidden] = useState(() => noticeDismissed(SCHEDULE_NOTICE));
  const hideNotice = (forever: boolean) => {
    dismissNotice(SCHEDULE_NOTICE, forever);
    setNoticeHidden(true);
  };
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFiltersState] = useState<Filters>(() => remembered.get(type) ?? initialFilters(type));
  const label = type === "post" ? "記事" : "固定ページ";
  const publish = usePublishStatus();

  const setFilters = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    remembered.set(type, next);
    setFiltersState(next);
  };

  useEffect(() => {
    setPosts(null);
    setError(null);
    setFiltersState(remembered.get(type) ?? initialFilters(type));
    listPosts(type)
      .then(setPosts)
      .catch((err) => setError(String(err)));
    if (type === "post") {
      listCategories().then(setCategories, () => {});
      listTags().then(setTags, () => {});
    }
  }, [type]);

  const titles = new Map(posts?.map((p) => [p.id, p.title]));
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));

  // A category also matches the posts in its child categories.
  const categoryWithChildren = useMemo(() => {
    if (filters.category === null) return null;
    const ids = new Set([filters.category]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of categories) {
        if (c.parent_id !== null && ids.has(c.parent_id) && !ids.has(c.id)) {
          ids.add(c.id);
          grew = true;
        }
      }
    }
    return ids;
  }, [filters.category, categories]);

  const shown = useMemo(() => {
    if (!posts) return null;
    const q = filters.query.trim().toLowerCase();
    const list = posts.filter(
      (p) =>
        (!q || p.title.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q)) &&
        (!filters.state || postState(p, publish) === filters.state) &&
        (!categoryWithChildren || p.category_ids.some((id) => categoryWithChildren.has(id))) &&
        (filters.tag === null || p.tag_ids.includes(filters.tag)),
    );
    const { sort } = filters;
    if (sort === "order") return list;
    const date = (p: PostSummary) => p.published_at ?? "9999";
    const by: Record<SortKey, (a: PostSummary, b: PostSummary) => number> = {
      title: (a, b) => a.title.localeCompare(b.title, "ja"),
      published: (a, b) => date(a).localeCompare(date(b)),
      updated: (a, b) => a.updated_at.localeCompare(b.updated_at),
    };
    const compare = by[sort.key];
    return [...list].sort((a, b) => (sort.desc ? compare(b, a) : compare(a, b)));
  }, [posts, filters, publish, categoryWithChildren]);

  // Clicking the sorted column reverses it; on pages a third click goes back to their own order.
  const sortBy = (key: SortKey) => {
    const { sort } = filters;
    if (sort === "order" || sort.key !== key) setFilters({ sort: { key, desc: FIRST_DESC[key] } });
    else if (type === "page" && sort.desc !== FIRST_DESC[key]) setFilters({ sort: "order" });
    else setFilters({ sort: { key, desc: !sort.desc } });
  };

  const sortHeader = (key: SortKey, label: string) => {
    const active = filters.sort !== "order" && filters.sort.key === key ? filters.sort : null;
    const Icon = !active ? ArrowUpDown : active.desc ? ArrowDown : ArrowUp;
    return (
      <UnstyledButton
        className="sort-header"
        data-active={active ? true : undefined}
        onClick={() => sortBy(key)}
        aria-label={`${label}で並べ替え`}
      >
        {label}
        <Icon size={14} />
      </UnstyledButton>
    );
  };

  const filtering = filters.query.trim() !== "" || filters.state !== null || filters.category !== null || filters.tag !== null;
  // 予約 is offered only when it can match: the schedule is on, or such posts exist.
  const anyScheduled = !!posts?.some((p) => postState(p, publish) === "scheduled");
  const states = (Object.keys(POST_STATE_LABELS) as PostState[]).filter(
    (s) => s !== "scheduled" || scheduling !== false || anyScheduled || filters.state === "scheduled",
  );

  return (
    <Stack gap="md" className="list">
      <PageHeader title={label}>
        <Button variant="filled" leftSection={<Plus size={16} />} onClick={() => onOpen(null)}>
          新規作成
        </Button>
      </PageHeader>
      {type === "post" && scheduling === false && !noticeHidden && (
        <Alert
          compact
          level="info"
          title="予約投稿（公開日時を過ぎたら自動で公開）を使うには、GitHub 連携が必要です"
          onClose={() => hideNotice(false)}
          actions={
            <>
              <Button size="xs" variant="subtle" color="gray" onClick={() => hideNotice(true)}>
                今後表示しない
              </Button>
              <Button size="xs" leftSection={<GitBranch size={14} />} onClick={onOpenGitHub}>
                GitHub 連携を設定する
              </Button>
            </>
          }
        />
      )}
      {error && <Alert level="error">{error}</Alert>}
      {!posts && !error && <Text c="dimmed">読み込み中…</Text>}
      {posts?.length === 0 && (
        <Paper withBorder p="xl" radius="md">
          <Text c="dimmed" ta="center">
            {label}はまだありません。「新規作成」から書き始めましょう。
          </Text>
        </Paper>
      )}
      {posts && posts.length > 0 && shown && (
        <>
          <Group gap="sm" className="list-filters">
            <TextInput
              placeholder="タイトル・スラッグで検索"
              leftSection={<Search size={16} />}
              w={240}
              value={filters.query}
              onChange={(e) => setFilters({ query: e.target.value })}
            />
            <Menu
              fullWidth={false}
              label={filters.state ? POST_STATE_LABELS[filters.state].label : "すべての状態"}
              items={[
                { key: "all", label: "すべての状態", checked: filters.state === null, onSelect: () => setFilters({ state: null }) },
                ...states.map((s) => ({
                  key: s,
                  label: POST_STATE_LABELS[s].label,
                  checked: filters.state === s,
                  onSelect: () => setFilters({ state: s }),
                })),
              ]}
            />
            {type === "post" && categories.length > 0 && (
              <Select
                placeholder="すべてのカテゴリー"
                w={200}
                searchable
                clearable
                nothingFoundMessage="見つかりません"
                data={categoryTree(categories).map(({ category, depth }) => ({
                  value: String(category.id),
                  label: `${"　".repeat(depth)}${category.name}`,
                }))}
                value={filters.category === null ? null : String(filters.category)}
                onChange={(v) => setFilters({ category: v ? Number(v) : null })}
                comboboxProps={{ withinPortal: true }}
              />
            )}
            {type === "post" && tags.length > 0 && (
              <Select
                placeholder="すべてのタグ"
                w={180}
                searchable
                clearable
                nothingFoundMessage="見つかりません"
                data={tags.map((t) => ({ value: String(t.id), label: t.name }))}
                value={filters.tag === null ? null : String(filters.tag)}
                onChange={(v) => setFilters({ tag: v ? Number(v) : null })}
                comboboxProps={{ withinPortal: true }}
              />
            )}
            <Group gap="xs" ml="auto">
              {type === "page" && filters.sort !== "order" && (
                <Button
                  variant="subtle"
                  color="gray"
                  size="xs"
                  leftSection={<X size={14} />}
                  onClick={() => setFilters({ sort: "order" })}
                >
                  並び順に戻す
                </Button>
              )}
              {filtering && (
                <Button
                  variant="subtle"
                  color="gray"
                  size="xs"
                  leftSection={<X size={14} />}
                  onClick={() => setFilters({ ...initialFilters(type), sort: filters.sort })}
                >
                  条件を外す
                </Button>
              )}
              <Text size="sm" c="dimmed">
                {filtering ? `${shown.length} / ${posts.length} 件` : `${posts.length} 件`}
              </Text>
            </Group>
          </Group>
          <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
            <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{sortHeader("title", "タイトル")}</Table.Th>
                  <Table.Th w={90}>状態</Table.Th>
                  {type === "page" && <Table.Th>親ページ</Table.Th>}
                  <Table.Th w={160}>{sortHeader("published", "公開日")}</Table.Th>
                  <Table.Th w={160}>{sortHeader("updated", "更新日")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {shown.map((p) => (
                  <Table.Tr key={p.id} onClick={() => onOpen(p.id)} style={{ cursor: "pointer" }}>
                    <Table.Td>
                      <Text fw={600} size="sm">
                        {p.title || "無題"}
                      </Text>
                      <Text size="xs" c="dimmed">
                        /{p.slug}
                        {p.category_ids.length > 0 &&
                          `　${p.category_ids
                            .map((id) => categoryNames.get(id))
                            .filter(Boolean)
                            .join("・")}`}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <PostStateBadge state={postState(p, publish)} scheduling={scheduling} />
                    </Table.Td>
                    {type === "page" && <Table.Td>{p.parent_id ? titles.get(p.parent_id) : ""}</Table.Td>}
                    <Table.Td>
                      <Text size="sm">{formatDate(p.published_at)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {formatDate(p.updated_at)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
                {shown.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={type === "page" ? 5 : 4}>
                      <Text size="sm" c="dimmed" ta="center" py="md">
                        条件に合う{label}はありません。
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </Paper>
        </>
      )}
    </Stack>
  );
}
