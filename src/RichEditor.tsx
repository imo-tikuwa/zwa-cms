import { useEffect, useRef, useState } from "react";
import { EditorContent, ReactNodeViewRenderer, useEditor, useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import type { EditorView } from "@tiptap/pm/view";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Bold,
  Code,
  CircleHelp,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  SquareCode,
  Strikethrough,
  Undo2,
} from "lucide-react";
import { BodyFormat } from "./lib/posts";
import { lowlight } from "./lib/codeLanguages";
import { CodeBlockView } from "./CodeBlockView";
import { Media, displaySrc, publicPath, uploadMedia } from "./lib/media";
import { MediaPicker } from "./MediaPicker";
import { ActionIcon, Box, Button, Group, Loader, Text, TextInput, Tooltip } from "@mantine/core";
import { Alert } from "./ui/Alert";

type Props = {
  /** Initial content. Changing it after mount has no effect; remount with a key instead. */
  value: string;
  format: BodyFormat;
  /** Called with serialized content (Markdown or HTML) on user edits only. */
  onChange: (value: string) => void;
  /**
   * Called once with the content as the editor serializes it, which can
   * differ from `value` in whitespace and syntax without any edit.
   */
  onNormalize?: (normalized: string, original: string) => void;
  /**
   * Called instead of `onNormalize` when the serialized content has lost
   * text, i.e. the body has syntax the editor can't represent.
   */
  onUnsupported?: () => void;
};

// Bodies keep the public path (/media/...); the webview loads it through
// the zwa-media protocol. A node view changes only what is displayed, not
// what is serialized.
const MediaImage = Image.extend({
  addNodeView() {
    return ({ node }) => {
      const img = document.createElement("img");
      const apply = (attrs: Record<string, string | null>) => {
        img.src = displaySrc(attrs.src ?? "");
        img.alt = attrs.alt ?? "";
        if (attrs.title) img.title = attrs.title;
      };
      apply(node.attrs);
      return {
        dom: img,
        update: (updated) => {
          if (updated.type !== node.type) return false;
          apply(updated.attrs);
          return true;
        },
      };
    };
  },
});

// Code blocks get a language menu; lowlight colors the text.
const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
}).configure({ lowlight });

type UploadStatus = { start: () => void; done: () => void; fail: (message: string) => void };

/**
 * Screenshots pasted from the clipboard (e.g. Snipping Tool) arrive as
 * "image.png"; name them by date so the media library tells them apart.
 */
function nameClipboardImage(file: File) {
  if (!/^image\.\w+$/i.test(file.name) && file.name !== "") return file;
  const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return new File([file], `screenshot-${stamp}.${ext}`, { type: file.type });
}

/** Uploads pasted/dropped image files and inserts them at `pos`. */
function insertFiles(view: EditorView, files: File[], status: UploadStatus, pos?: number) {
  const images = files.filter((f) => f.type.startsWith("image/"));
  if (images.length === 0) return false;
  (async () => {
    for (const file of images.map(nameClipboardImage)) {
      status.start();
      try {
        const media = await uploadMedia(file);
        const node = view.state.schema.nodes.image.create({ src: publicPath(media), alt: media.alt_text });
        view.dispatch(view.state.tr.insert(pos ?? view.state.selection.from, node));
      } catch (err) {
        status.fail(`${file.name} をアップロードできませんでした: ${err}`);
      } finally {
        status.done();
      }
    }
  })();
  return true;
}

/**
 * The body as stored. The serializer's trailing blank lines vary from call
 * to call for the same document, so they are cut to one newline; without
 * that, opening a post and undoing an edit would look like a change.
 */
function serialize(editor: Editor, format: BodyFormat) {
  const out = format === "markdown" ? editor.getMarkdown() : editor.getHTML();
  return out.replace(/\s+$/, "") + "\n";
}

/** Letters and digits only, so syntax and whitespace changes don't count. */
const textLength = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "").length;

// Plain text that looks like Markdown (headings, lists, quotes, fences,
// links, emphasis) is pasted as formatted content instead of raw text.
const MARKDOWN_HINT = /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|- \[[ x]\]\s)|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*/m;

export function RichEditor({ value, format, onChange, onNormalize, onUnsupported }: Props) {
  const editorRef = useRef<Editor | null>(null);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // editorProps is created once, so it reaches the state through a ref.
  const status = useRef<UploadStatus>({
    start: () => {
      setUploadError(null);
      setUploading((n) => n + 1);
    },
    done: () => setUploading((n) => n - 1),
    fail: setUploadError,
  });
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: "https" },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      CodeBlock,
      MediaImage,
      Placeholder.configure({ placeholder: "本文を入力…（「# 」で見出し、「- 」で箇条書きなど、Markdown の記法がそのまま使えます）" }),
      Markdown,
    ],
    content: value,
    contentType: format,
    editorProps: {
      handlePaste: (view, event) => {
        if (insertFiles(view, Array.from(event.clipboardData?.files ?? []), status.current)) return true;
        const text = event.clipboardData?.getData("text/plain") ?? "";
        const html = event.clipboardData?.getData("text/html") ?? "";
        if (!html && MARKDOWN_HINT.test(text) && editorRef.current) {
          editorRef.current.commands.insertContent(text, { contentType: "markdown" });
          return true;
        }
        return false;
      },
      handleDrop: (view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        return insertFiles(view, files, status.current, pos);
      },
      // Ctrl/Cmd+click opens a link in the browser; a plain click edits it.
      handleClick: (_view, _pos, event) => {
        const link = (event.target as HTMLElement).closest("a");
        if (!link || !(event.ctrlKey || event.metaKey)) return false;
        const href = link.getAttribute("href");
        if (href) void openUrl(href);
        return true;
      },
    },
    onCreate: ({ editor }) => {
      const out = serialize(editor, format);
      if (out === value) return;
      if (textLength(out) < textLength(value)) onUnsupported?.();
      else onNormalize?.(out, value);
    },
    // Also fired by transactions that change nothing (e.g. on focus).
    onUpdate: ({ editor, transaction }) => {
      if (transaction.docChanged) onChange(serialize(editor, format));
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  return (
    <div className="rich-editor">
      {editor && <Toolbar editor={editor} />}
      {uploading > 0 && (
        <Group gap="xs" px="md" py={6} className="editor-status">
          <Loader size={14} />
          <Text size="sm" c="dimmed">
            画像をアップロードしています…（残り {uploading}）
          </Text>
        </Group>
      )}
      {uploadError && (
        <Box px="md" pt="xs">
          <Alert level="error" onClose={() => setUploadError(null)}>
            {uploadError}
          </Alert>
        </Box>
      )}
      <EditorContent editor={editor} className="rich-content" />
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["# ／ ## ／ ###", "見出し"],
  ["- または *", "箇条書き"],
  ["1.", "番号付きリスト"],
  ["[ ]", "チェックリスト"],
  ["> ", "引用"],
  ["```", "コードブロック"],
  ["---", "区切り線"],
  ["**太字**", "太字"],
  ["*斜体*", "斜体"],
  ["`コード`", "インラインコード"],
  ["Ctrl+K", "リンク"],
  ["Ctrl+クリック", "リンクをブラウザで開く"],
];

function Toolbar({ editor }: { editor: Editor }) {
  // Re-render only when the active marks/nodes change.
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
    }),
  });
  const chain = () => editor.chain().focus();

  // window.prompt is not available in every Tauri webview, so edit links inline.
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [help, setHelp] = useState(false);
  const openLink = () => setLinkDraft((editor.getAttributes("link").href as string | undefined) ?? "https://");
  const applyLink = () => {
    const href = linkDraft?.trim();
    if (!href || href === "https://") chain().extendMarkRange("link").unsetLink().run();
    else chain().extendMarkRange("link").setLink({ href }).run();
    setLinkDraft(null);
  };
  const insertMedia = (m: Media) => {
    chain().setImage({ src: publicPath(m), alt: m.alt_text ?? undefined }).run();
    setPicking(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && editor.isFocused) {
        e.preventDefault();
        openLink();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const B = ({ on, active, title, children }: { on: () => void; active?: boolean; title: string; children: React.ReactNode }) => (
    <Tooltip label={title}>
      <ActionIcon
        variant={active ? "light" : "subtle"}
        color={active ? undefined : "gray"}
        size="lg"
        aria-label={title}
        onMouseDown={(e) => e.preventDefault()}
        onClick={on}
      >
        {children}
      </ActionIcon>
    </Tooltip>
  );

  return (
    <div className="toolbar">
      <B title="見出し 2（## ）" active={s.h2} on={() => chain().toggleHeading({ level: 2 }).run()}><Heading2 size={17} /></B>
      <B title="見出し 3（### ）" active={s.h3} on={() => chain().toggleHeading({ level: 3 }).run()}><Heading3 size={17} /></B>
      <span className="sep" />
      <B title="太字（Ctrl+B）" active={s.bold} on={() => chain().toggleBold().run()}><Bold size={16} /></B>
      <B title="斜体（Ctrl+I）" active={s.italic} on={() => chain().toggleItalic().run()}><Italic size={16} /></B>
      <B title="取り消し線" active={s.strike} on={() => chain().toggleStrike().run()}><Strikethrough size={16} /></B>
      <B title="コード" active={s.code} on={() => chain().toggleCode().run()}><Code size={16} /></B>
      <B title="リンク（Ctrl+K）" active={s.link} on={openLink}><LinkIcon size={16} /></B>
      <span className="sep" />
      <B title="箇条書き（- ）" active={s.bullet} on={() => chain().toggleBulletList().run()}><List size={17} /></B>
      <B title="番号付きリスト（1. ）" active={s.ordered} on={() => chain().toggleOrderedList().run()}><ListOrdered size={17} /></B>
      <B title="チェックリスト（[ ] ）" active={s.task} on={() => chain().toggleTaskList().run()}><ListChecks size={17} /></B>
      <B title="引用（> ）" active={s.quote} on={() => chain().toggleBlockquote().run()}><Quote size={16} /></B>
      <B title="コードブロック（```）" active={s.codeBlock} on={() => chain().toggleCodeBlock().run()}><SquareCode size={16} /></B>
      <B title="区切り線（---）" on={() => chain().setHorizontalRule().run()}><Minus size={16} /></B>
      <B title="画像を挿入（貼り付け・ドロップでも可）" on={() => setPicking(true)}><ImagePlus size={17} /></B>
      <span className="sep" />
      <B title="元に戻す（Ctrl+Z）" on={() => chain().undo().run()}><Undo2 size={16} /></B>
      <B title="やり直す（Ctrl+Y）" on={() => chain().redo().run()}><Redo2 size={16} /></B>
      <span className="toolbar-spacer" />
      <B title="入力のヒント" active={help} on={() => setHelp(!help)}><CircleHelp size={16} /></B>
      {help && (
        <div className="shortcut-help">
          <Text size="xs" c="dimmed">
            行の先頭や文中で Markdown の記法を入力すると、その場で書式に変わります。
          </Text>
          <dl>
            {SHORTCUTS.map(([key, label]) => (
              <div key={key}>
                <dt><code>{key}</code></dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {linkDraft !== null && (
        <span className="link-input">
          <TextInput
            flex={1}
            size="xs"
            value={linkDraft}
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              } else if (e.key === "Escape") {
                setLinkDraft(null);
                editor.commands.focus();
              }
            }}
            placeholder="URL（空にするとリンクを解除）"
            autoFocus
          />
          <Button size="xs" variant="filled" onClick={applyLink}>
            適用
          </Button>
          <Button size="xs" onClick={() => setLinkDraft(null)}>
            取消
          </Button>
        </span>
      )}
      {picking && <MediaPicker onPick={insertMedia} onClose={() => setPicking(false)} />}
    </div>
  );
}
