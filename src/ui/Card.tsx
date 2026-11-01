import { ReactNode } from "react";
import { Group, Paper, Stack, Text, Title } from "@mantine/core";

type Props = {
  title?: ReactNode;
  /** A sentence or two under the title. */
  description?: ReactNode;
  /** Buttons at the right of the title. */
  actions?: ReactNode;
  children?: ReactNode;
  /** Renders as a <form> with this submit handler. */
  onSubmit?: (e: React.FormEvent) => void;
};

/** A white panel on the gray canvas: the unit of settings-style screens. */
export function Card({ title, description, actions, children, onSubmit }: Props) {
  const body = (
    <Stack gap="md">
      {(title || actions) && (
        <Stack gap={4}>
          <Group justify="space-between" wrap="nowrap" gap="sm">
            {title && (
              <Title order={2} size="h4" fw={700}>
                {title}
              </Title>
            )}
            {actions && (
              <Group gap="xs" wrap="nowrap">
                {actions}
              </Group>
            )}
          </Group>
          {description && (
            <Text size="sm" c="dimmed">
              {description}
            </Text>
          )}
        </Stack>
      )}
      {children}
    </Stack>
  );
  return (
    <Paper withBorder radius="md" p="lg" component={onSubmit ? "form" : "div"} onSubmit={onSubmit}>
      {body}
    </Paper>
  );
}
