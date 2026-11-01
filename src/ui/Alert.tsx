import { ReactNode, useRef } from "react";
import { CloseButton, Group } from "@mantine/core";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { CopyButton } from "./CopyButton";

export type AlertLevel = "info" | "success" | "warning" | "error";

const ICONS: Record<AlertLevel, ReactNode> = {
  info: <Info size={18} />,
  success: <CircleCheck size={18} />,
  warning: <TriangleAlert size={18} />,
  error: <CircleAlert size={18} />,
};

type Props = {
  level?: AlertLevel;
  title?: ReactNode;
  children?: ReactNode;
  /** Buttons: under the message, or on the right when compact. */
  actions?: ReactNode;
  /** Shows a close button. */
  onClose?: () => void;
  /** One line (title and actions side by side), for notices above a screen. */
  compact?: boolean;
  /** Overrides the copy button (on by default for errors and warnings). */
  copy?: boolean;
};

/**
 * A message with a severity level (info / success / warning / error). All
 * levels share one look: a white panel whose left edge and icon carry the
 * level's color (styles.css `.notice`). Errors and warnings get a copy button,
 * so messages (often the API's own English text) can be pasted into a report.
 */
export function Alert({ level = "info", title, children, actions, onClose, compact, copy }: Props) {
  const body = useRef<HTMLDivElement>(null);
  const copyable = copy ?? (level === "error" || level === "warning");
  return (
    <div
      className={`notice notice-${level}${compact ? " notice-compact" : ""}`}
      role={level === "error" || level === "warning" ? "alert" : "status"}
    >
      <span className="notice-icon">{ICONS[level]}</span>
      <div className="notice-body" ref={body}>
        {title && <div className="notice-title">{title}</div>}
        {children && <div className="notice-text">{children}</div>}
        {!compact && actions && (
          <Group gap="xs" mt={6}>
            {actions}
          </Group>
        )}
      </div>
      {compact && actions && (
        <Group gap="xs" wrap="nowrap">
          {actions}
        </Group>
      )}
      {copyable && <CopyButton text={() => body.current?.innerText ?? ""} />}
      {onClose && <CloseButton size="sm" aria-label="閉じる" title="閉じる" onClick={onClose} />}
    </div>
  );
}
