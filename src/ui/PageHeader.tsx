import { ReactNode } from "react";
import { Group, Title } from "@mantine/core";

/** Page title with actions on the right. Never wraps the title. */
export function PageHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <Group className="page-header" justify="space-between" wrap="nowrap" gap="md">
      <Title order={1} size="h3" fw={700} style={{ whiteSpace: "nowrap" }}>
        {title}
      </Title>
      {children && (
        <Group gap="xs" wrap="nowrap">
          {children}
        </Group>
      )}
    </Group>
  );
}
