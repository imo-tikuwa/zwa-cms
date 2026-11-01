import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import type { ReactNodeViewProps } from "@tiptap/react";
import { ComboboxItem, OptionsFilter, Select } from "@mantine/core";
import { CODE_LANGUAGES } from "./lib/codeLanguages";

const NONE = "";
const NONE_LABEL = "言語なし";

/** Matches the label, the name written after ```, or a short name (`ts`). */
function matches(value: string, search: string) {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  if (value === NONE) return NONE_LABEL.includes(q);
  const lang = CODE_LANGUAGES.find((l) => l.value === value);
  const names = [value, lang?.label ?? value, ...(lang?.aliases ?? [])].map((n) => n.toLowerCase());
  return names.some((n) => n.includes(q));
}

const OPEN_WIDTH = 150;
let canvas: HTMLCanvasElement | null = null;

/** The input's width that just fits `text`, with its padding (the arrow's room included). */
function fitWidth(text: string, input: HTMLElement) {
  canvas ??= document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return OPEN_WIDTH;
  const style = getComputedStyle(input);
  // The `font` shorthand reads back empty for inputs here, so build it.
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  return Math.min(OPEN_WIDTH, Math.ceil(ctx.measureText(text).width + padding) + 2);
}

const filter: OptionsFilter = ({ options, search }) =>
  (options as ComboboxItem[]).filter((o) => matches(o.value, search));

/**
 * A code block with its language shown quietly at the top right; hovering
 * turns it into a menu. The language is the name written after ``` in
 * Markdown; a name typed there that isn't in the list (e.g. `ts`) is kept
 * and shown as is. Typing a name that matches nothing and leaving the menu
 * (Enter or clicking away) clears the language.
 *
 * Closed, the box fits the label at the right; open, it widens to the left,
 * so the left-aligned text slides over to line up with the list below.
 */
export function CodeBlockView({ node, updateAttributes }: ReactNodeViewProps) {
  const language = (node.attrs.language as string | null) ?? NONE;
  const data = [{ value: NONE, label: NONE_LABEL }, ...CODE_LANGUAGES.map(({ value, label }) => ({ value, label }))];
  if (language && !CODE_LANGUAGES.some((l) => l.value === language)) data.push({ value: language, label: language });
  const labelOf = (v: string) => data.find((d) => d.value === v)?.label ?? v;

  // The search text is ours: Mantine leaves it as typed when the chosen
  // option is the current one (e.g. "Ru" after picking Rust again).
  const [search, setSearch] = useState(labelOf(language));
  useEffect(() => setSearch(labelOf(language)), [language]);

  const choose = (v: string) => {
    if (v !== language) updateAttributes({ language: v || null });
    setSearch(labelOf(v));
  };
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [width, setWidth] = useState(OPEN_WIDTH);
  useLayoutEffect(() => {
    const measure = () => input.current && setWidth(fitWidth(labelOf(language), input.current));
    measure();
    // The bundled font may still be loading; measure again once it is in.
    void document.fonts.ready.then(measure);
  }, [language]);
  const typedNothing = () => search.trim() !== "" && search !== labelOf(language) && !data.some((d) => matches(d.value, search));

  return (
    <NodeViewWrapper className="code-block">
      <div className={`code-block-language${language ? "" : " is-empty"}`} contentEditable={false}>
        <Select
          ref={input}
          size="xs"
          w={focused ? OPEN_WIDTH : width}
          variant="unstyled"
          classNames={{
            root: "code-block-language-root",
            input: `code-block-language-input${language ? " is-set" : ""}`,
            section: "code-block-language-chevron",
          }}
          searchable
          selectFirstOptionOnChange
          allowDeselect={false}
          aria-label="コードの言語"
          data={data}
          filter={filter}
          value={language}
          searchValue={search}
          onSearchChange={setSearch}
          onOptionSubmit={choose}
          onKeyDown={(e) => {
            if (e.key === "Enter" && typedNothing()) e.currentTarget.blur();
          }}
          onFocus={(e) => {
            setFocused(true);
            // Typing replaces the shown name instead of appending to it.
            e.currentTarget.select();
          }}
          onBlur={() => {
            setFocused(false);
            if (typedNothing()) choose(NONE);
            else setSearch(labelOf(language));
          }}
          comboboxProps={{ withinPortal: true, position: "bottom-end", width: OPEN_WIDTH }}
          nothingFoundMessage="未対応の言語です"
        />
      </div>
      <pre>
        <NodeViewContent<"code"> as="code" />
      </pre>
    </NodeViewWrapper>
  );
}
