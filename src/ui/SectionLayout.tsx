import { ReactNode } from "react";
import { NavLink, Stack, Text } from "@mantine/core";
import { PageHeader } from "./PageHeader";

export type Section<K extends string> = { key: K; label: string; icon: ReactNode };

type Props<K extends string> = {
  title: string;
  /** A line under the title. */
  description?: ReactNode;
  sections: Section<K>[];
  active: K;
  onSelect: (key: K) => void;
  /** Shown above both columns (e.g. a notice that concerns every section). */
  notice?: ReactNode;
  children: ReactNode;
};

/** Settings-style screen: section menu on the left, the section's cards on the right. */
export function SectionLayout<K extends string>({ title, description, sections, active, onSelect, notice, children }: Props<K>) {
  return (
    <div className="settings-layout">
      <Stack gap={4}>
        <PageHeader title={title} />
        {description && (
          <Text size="sm" c="dimmed" mt={-12}>
            {description}
          </Text>
        )}
      </Stack>
      {notice}
      <div className="settings-body">
        <nav className="settings-nav">
          {sections.map((s) => (
            <NavLink
              key={s.key}
              component="button"
              label={s.label}
              leftSection={s.icon}
              active={active === s.key}
              onClick={() => onSelect(s.key)}
            />
          ))}
        </nav>
        <Stack gap="lg">{children}</Stack>
      </div>
    </div>
  );
}
