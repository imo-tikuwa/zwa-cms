import { useEffect, useState } from "react";
import { Checkbox, Input, Stack, TagsInput, Text } from "@mantine/core";
import { Category, Tag, categoryTree, listCategories, listTags, saveTag, suggestSlug } from "./lib/taxonomy";
import { createReadingTracker } from "./lib/reading";

type Props = {
  categoryIds: number[];
  tagIds: number[];
  onChange: (patch: { category_ids?: number[]; tag_ids?: number[] }) => void;
};

/** Category checkboxes and tag input for the post editor sidebar. */
export function TermPicker({ categoryIds, tagIds, onChange }: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);
  // New tags typed in Japanese get romaji slugs.
  const [reading] = useState(createReadingTracker);

  useEffect(() => {
    listCategories().then(setCategories).catch((err) => setError(String(err)));
  }, []);

  // Reload when a tag was added elsewhere (e.g. by AI suggestions).
  const unknownTag = tagIds.some((id) => !tags.some((t) => t.id === id));
  useEffect(() => {
    listTags().then(setTags).catch((err) => setError(String(err)));
  }, [unknownTag]);

  const toggleCategory = (id: number) =>
    onChange({
      category_ids: categoryIds.includes(id) ? categoryIds.filter((c) => c !== id) : [...categoryIds, id],
    });

  /** Names in the input -> tag IDs, creating tags for new names. */
  const setTagNames = async (names: string[]) => {
    setError(null);
    const known = [...tags];
    const ids: number[] = [];
    for (const raw of names) {
      const name = raw.trim();
      if (!name) continue;
      // A tag not loaded yet is shown as #<id>; keep it as is.
      const pending = tagIds.find((id) => `#${id}` === name);
      if (pending !== undefined) {
        ids.push(pending);
        continue;
      }
      let tag = known.find((t) => t.name === name);
      if (!tag) {
        try {
          const slug = suggestSlug(name, reading);
          const id = await saveTag({ id: null, name, slug, description: null });
          tag = { id, name, slug, description: null, post_count: 0 };
          known.push(tag);
        } catch (err) {
          setError(String(err));
          continue;
        }
      }
      if (!ids.includes(tag.id)) ids.push(tag.id);
    }
    setTags(known);
    onChange({ tag_ids: ids });
  };

  return (
    <>
      <Input.Wrapper label="カテゴリー">
        {categories.length === 0 ? (
          <Text size="sm" c="dimmed">
            「カテゴリー・タグ」画面で作成できます。
          </Text>
        ) : (
          <Stack gap={8} mt={6}>
            {categoryTree(categories).map(({ category, depth }) => (
              <Checkbox
                key={category.id}
                label={category.name}
                checked={categoryIds.includes(category.id)}
                onChange={() => toggleCategory(category.id)}
                style={{ paddingLeft: depth * 20 }}
              />
            ))}
          </Stack>
        )}
      </Input.Wrapper>
      <TagsInput
        label="タグ"
        description="入力して Enter で追加します。ないタグは新しく作ります。"
        placeholder="タグを追加"
        data={tags.map((t) => t.name)}
        value={tagIds.map((id) => tags.find((t) => t.id === id)?.name ?? `#${id}`)}
        onChange={setTagNames}
        clearable
        error={error}
        comboboxProps={{ withinPortal: true }}
        onCompositionUpdate={reading.onCompositionUpdate}
        onCompositionEnd={reading.onCompositionEnd}
      />
    </>
  );
}
