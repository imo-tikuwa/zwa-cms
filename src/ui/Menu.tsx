import { ReactNode } from "react";
import { ActionIcon, Button, Menu as MantineMenu } from "@mantine/core";
import { Check, ChevronsUpDown } from "lucide-react";

export type MenuItem =
  | { kind?: "item"; key: string; label: ReactNode; icon?: ReactNode; checked?: boolean; danger?: boolean; onSelect: () => void }
  | { kind: "separator"; key: string }
  | { kind: "heading"; key: string; label: ReactNode };

type Props = {
  /** Button content. */
  label: ReactNode;
  icon?: ReactNode;
  items: MenuItem[];
  /** Open upward (for menus at the bottom of the sidebar). */
  up?: boolean;
  disabled?: boolean;
  title?: string;
  /** Icon-only trigger (e.g. in the title bar); the list aligns right. */
  compact?: boolean;
  /** Stretch the button to the container (the default). */
  fullWidth?: boolean;
};

/** A button that opens a list of choices or actions (instead of <select>). */
export function Menu({ label, icon, items, up, disabled, title, compact, fullWidth = true }: Props) {
  return (
    <MantineMenu
      position={compact ? "bottom-end" : up ? "top-start" : "bottom-start"}
      width={compact ? 220 : "target"}
      withinPortal
      disabled={disabled}
    >
      <MantineMenu.Target>
        {compact ? (
          <ActionIcon variant="subtle" color="gray" size="lg" title={title} aria-label={title} disabled={disabled}>
            {icon}
          </ActionIcon>
        ) : (
          <Button
            title={title}
            disabled={disabled}
            leftSection={icon}
            rightSection={<ChevronsUpDown size={14} />}
            justify="space-between"
            fullWidth={fullWidth}
            styles={{ label: { flex: 1, overflow: "hidden", textOverflow: "ellipsis" } }}
          >
            {label}
          </Button>
        )}
      </MantineMenu.Target>
      <MantineMenu.Dropdown miw={compact ? undefined : 200}>
        {compact && label && <MantineMenu.Label>{label}</MantineMenu.Label>}
        {items.map((item) =>
          item.kind === "separator" ? (
            <MantineMenu.Divider key={item.key} />
          ) : item.kind === "heading" ? (
            <MantineMenu.Label key={item.key}>{item.label}</MantineMenu.Label>
          ) : (
            <MantineMenu.Item
              key={item.key}
              color={item.danger ? "red" : undefined}
              leftSection={item.icon}
              rightSection={item.checked ? <Check size={14} /> : undefined}
              fw={item.checked ? 600 : undefined}
              // Choosing what is already chosen does nothing (no "saved" toast).
              onClick={item.checked ? undefined : item.onSelect}
            >
              {item.label}
            </MantineMenu.Item>
          ),
        )}
      </MantineMenu.Dropdown>
    </MantineMenu>
  );
}
