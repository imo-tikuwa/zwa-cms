import { useEffect, useState } from "react";
import { BarChart3, Cpu, MessageSquarePlus, Plus, Settings, Trash2 } from "lucide-react";
import {
  AiSettings,
  AiUsageRow,
  CustomPrompt,
  MODEL_LABELS,
  aiStatus,
  aiUsage,
  estimateCost,
  getAiSettings,
  saveAiSettings,
} from "./lib/ai";
import { ActionIcon, Button, Group, Paper, Radio, Stack, Table, Text, TextInput, Textarea } from "@mantine/core";
import { Alert } from "./ui/Alert";
import { toast } from "./ui/Toast";
import { Card } from "./ui/Card";
import { Section, SectionLayout } from "./ui/SectionLayout";
import { MessageText } from "./ui/CopyButton";

type Message = { error: boolean; text: string } | null;

type AiSection = "model" | "prompts" | "usage";

const SECTIONS: Section<AiSection>[] = [
  { key: "model", label: "モデルと執筆方針", icon: <Cpu size={16} /> },
  { key: "prompts", label: "独自のプロンプト", icon: <MessageSquarePlus size={16} /> },
  { key: "usage", label: "使用量", icon: <BarChart3 size={16} /> },
];

/** Per-site AI settings and usage. The API key is per PC (app settings). */
export function AiScreen({ hasKey, onOpenAppSettings }: { hasKey: boolean | null; onOpenAppSettings: () => void }) {
  const [section, setSection] = useState<AiSection>("model");
  const notice = hasKey === false && (
    <Alert
      level="info"
      title="Claude の API キーが登録されていません"
      actions={
        <Button size="xs" leftSection={<Settings size={14} />} onClick={onOpenAppSettings}>
          アプリの設定を開く
        </Button>
      }
    >
      <p>AI 機能を使うには、この PC に API キーを登録してください（すべてのサイトで共通です）。</p>
    </Alert>
  );
  return (
    <SectionLayout
      title="AI"
      description="このサイトの AI の設定です。サイトごとに保存され、どの PC からも同じ設定が使われます。"
      sections={SECTIONS}
      active={section}
      onSelect={setSection}
      notice={notice}
    >
      {section === "usage" ? <UsageCard /> : <SettingsForm section={section} />}
    </SectionLayout>
  );
}

/**
 * Model, guidelines and custom prompts: one form stored in D1, so unsaved
 * edits survive switching between its two sections.
 */
function SettingsForm({ section }: { section: Exclude<AiSection, "usage"> }) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [defaultModel, setDefaultModelState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  useEffect(() => {
    getAiSettings()
      .then(setSettings)
      .catch((err) => setMessage({ error: true, text: String(err) }));
    aiStatus()
      .then((s) => {
        setModels(s.models);
        setDefaultModelState(s.default_model);
      })
      .catch(() => {});
  }, []);

  if (!settings) return message ? <Alert level="error">{message.text}</Alert> : null;

  const setPrompt = (i: number, patch: Partial<CustomPrompt>) =>
    setSettings({ ...settings, prompts: settings.prompts.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await saveAiSettings(settings);
      toast("AI の設定を保存しました");
    } catch (err) {
      setMessage({ error: true, text: String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save}>
      <Stack gap="lg">
        {section === "model" && (
          <Card title="モデルと執筆方針">
            <Radio.Group
              label="モデル"
              description="高性能なモデルほど文章の質が上がり、料金も高くなります。"
              value={settings.model}
              onChange={(model) => setSettings({ ...settings, model })}
            >
              <Stack gap="xs" mt="xs">
                <Radio
                  value=""
                  label="PC の既定のモデルを使う"
                  description={
                    defaultModel &&
                    `この PC では ${MODEL_LABELS[defaultModel]?.replace(/（.*）$/, "") ?? defaultModel} です（アプリの設定の「AI」で変えられます）。PC ごとに違うことがあります。`
                  }
                />
                {models.map((m) => (
                  <Radio key={m} value={m} label={MODEL_LABELS[m] ?? m} />
                ))}
              </Stack>
            </Radio.Group>
            <Textarea
              label="執筆方針"
              description="すべての AI 機能に伝えます。サイトの文体や読者像を書いておくと、提案がそろいます。"
              autosize
              minRows={4}
              value={settings.guidelines}
              onChange={(e) => setSettings({ ...settings, guidelines: e.target.value })}
              placeholder={"例: です・ます調で書く。専門用語には短い説明を付ける。読者は初心者。"}
            />
          </Card>
        )}

        {section === "prompts" && (
          <Card
            title="独自のプロンプト"
            description="よく使う指示を、記事の編集画面の「AI アシスタント」にボタンとして追加できます。記事のタイトルと本文が一緒に渡されます。"
            actions={
              <Button
                size="xs"
                leftSection={<Plus size={14} />}
                onClick={() =>
                  setSettings({
                    ...settings,
                    prompts: [...settings.prompts, { id: crypto.randomUUID(), name: "", prompt: "", target: "panel" }],
                  })
                }
              >
                プロンプトを追加
              </Button>
            }
          >
            {settings.prompts.length === 0 && (
              <Text size="sm" c="dimmed">
                まだありません。
              </Text>
            )}
            {settings.prompts.map((p, i) => (
              <Paper key={p.id} withBorder radius="md" p="md" bg="var(--surface-2)">
                <Stack gap="sm">
                  <Group gap="xs" wrap="nowrap" align="flex-end">
                    <TextInput
                      label="ボタンの名前"
                      flex={1}
                      value={p.name}
                      onChange={(e) => setPrompt(i, { name: e.target.value })}
                      placeholder="例: 箇条書きに整理"
                    />
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      size="lg"
                      title="このプロンプトを削除"
                      onClick={() => setSettings({ ...settings, prompts: settings.prompts.filter((_, j) => j !== i) })}
                    >
                      <Trash2 size={16} />
                    </ActionIcon>
                  </Group>
                  <Textarea
                    label="AI への指示"
                    autosize
                    minRows={3}
                    value={p.prompt}
                    onChange={(e) => setPrompt(i, { prompt: e.target.value })}
                    placeholder="例: 本文の要点を箇条書きで 5 つにまとめてください。"
                  />
                  <Radio.Group
                    label="AI の回答をどう使うか"
                    value={p.target}
                    onChange={(v) => setPrompt(i, { target: v as CustomPrompt["target"] })}
                  >
                    <Stack gap="xs" mt="xs">
                      <Radio
                        value="panel"
                        label="読むだけ"
                        description="回答をアシスタントの欄に表示します。本文は変わりません（例: 要約、感想、改善点の指摘）。"
                      />
                      <Radio
                        value="body"
                        label="本文と入れ替える"
                        description="回答を新しい本文として、変更箇所を確認してから反映します。反映後も元に戻せます（例: 書き直し、整形）。"
                      />
                    </Stack>
                  </Radio.Group>
                </Stack>
              </Paper>
            ))}
          </Card>
        )}

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
  );
}

const fmtTokens = (n: number) => n.toLocaleString("ja-JP");
const fmtUsd = (n: number) => `$${n < 0.01 && n > 0 ? "<0.01" : n.toFixed(2)}`;

/** Tokens recorded in D1 by every PC that used AI on this site. */
function UsageCard() {
  const [rows, setRows] = useState<AiUsageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    aiUsage()
      .then(setRows)
      .catch((err) => setError(String(err)));
  }, []);

  const months = [...new Set((rows ?? []).map((r) => r.month))];

  return (
    <Card
      title="このサイトの使用量"
      description="このサイトで AI を使った分を、どの PC からの分も合わせて月ごとに表示します（UTC）。金額は定価からの目安で、中止したリクエストは含みません。実際の請求額は Claude Console の Usage / Billing で確認してください。"
    >
      {error && <Alert level="error">{error}</Alert>}
      {rows?.length === 0 && (
        <Text size="sm" c="dimmed">
          まだ使っていません。
        </Text>
      )}
      {months.map((month) => {
        const items = rows!.filter((r) => r.month === month);
        const costs = items.map(estimateCost);
        const total = costs.every((c) => c !== null) ? costs.reduce<number>((a, c) => a + c!, 0) : null;
        return (
          <Stack key={month} gap={6}>
            <Group gap="xs">
              <Text fw={600} size="sm">
                {month}
              </Text>
              {total !== null && (
                <Text size="sm" c="dimmed">
                  約 {fmtUsd(total)}
                </Text>
              )}
            </Group>
            <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
              <Table verticalSpacing={6} horizontalSpacing="md">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>モデル</Table.Th>
                    <Table.Th ta="right">回数</Table.Th>
                    <Table.Th ta="right">入力</Table.Th>
                    <Table.Th ta="right">出力</Table.Th>
                    <Table.Th ta="right">目安</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {items.map((r, i) => (
                    <Table.Tr key={r.model}>
                      <Table.Td>{MODEL_LABELS[r.model]?.replace(/（.*）$/, "") ?? r.model}</Table.Td>
                      <Table.Td ta="right">{r.requests}</Table.Td>
                      <Table.Td ta="right">{fmtTokens(r.input_tokens + r.cache_read_tokens + r.cache_write_tokens)}</Table.Td>
                      <Table.Td ta="right">{fmtTokens(r.output_tokens)}</Table.Td>
                      <Table.Td ta="right">{costs[i] === null ? "—" : fmtUsd(costs[i]!)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>
          </Stack>
        );
      })}
    </Card>
  );
}
