import { ReactNode, useEffect, useState } from "react";
import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { playSound } from "../lib/app";

type Props = {
  title: ReactNode;
  /** What will happen, e.g. what gets deleted and whether it can be undone. */
  children?: ReactNode;
  confirmLabel: ReactNode;
  /** Defaults to "やめる". */
  cancelLabel?: ReactNode;
  /** Red confirm button, for destructive actions. */
  danger?: boolean;
  /** Keeps the confirm button disabled, e.g. until a name is typed. */
  confirmDisabled?: boolean;
  /** Errors thrown here are shown in the dialog, which then stays open. */
  onConfirm: () => unknown | Promise<unknown>;
  onClose: () => void;
};

/**
 * A modal confirmation. Focus starts on the cancel button so that a double
 * click or Enter on the triggering button can't confirm by accident.
 */
export function ConfirmDialog({ title, children, confirmLabel, cancelLabel = "やめる", danger, confirmDisabled, onConfirm, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Like a Windows message box: "Exclamation" for destructive actions.
  useEffect(() => playSound(danger ? "warning" : "info"), []);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      opened
      onClose={() => !busy && onClose()}
      title={<Text fw={600}>{title}</Text>}
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
      withCloseButton={false}
      size="md"
      zIndex={400}
    >
      <Stack gap="md">
        {children && <div className="confirm-body">{children}</div>}
        {error && (
          <Text c="red" size="sm" style={{ whiteSpace: "pre-wrap" }}>
            {error}
          </Text>
        )}
        <Group justify="flex-end" gap="sm">
          <Button disabled={busy} onClick={onClose} data-autofocus>
            {cancelLabel}
          </Button>
          <Button
            variant="filled"
            color={danger ? "red" : undefined}
            loading={busy}
            disabled={confirmDisabled}
            onClick={confirm}
          >
            {confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
