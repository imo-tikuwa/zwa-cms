import { useEffect, useState } from "react";
import { ActionIcon, Group, Text, TextProps } from "@mantine/core";
import { Check, Copy } from "lucide-react";

type Props = {
  /** The text to copy, read at click time (e.g. from a ref). */
  text: () => string;
};

/** Small icon button that copies text to the clipboard, e.g. an error message to report. */
export function CopyButton({ text }: Props) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const label = copied ? "コピーしました" : "コピー";
  return (
    <ActionIcon
      variant="subtle"
      color={copied ? "green" : "gray"}
      size="sm"
      title={label}
      aria-label={label}
      onClick={() => {
        navigator.clipboard.writeText(text().trim()).then(
          () => setCopied(true),
          (err) => console.warn("copy failed", err),
        );
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </ActionIcon>
  );
}

type MessageProps = Omit<TextProps, "c"> & { error?: boolean; children: string };

/** A one-off result line under a form: dimmed, or red with a copy button when it is an error. */
export function MessageText({ error, children, ...props }: MessageProps) {
  const text = (
    <Text {...props} c={error ? "red" : "dimmed"} style={{ whiteSpace: "pre-wrap", minWidth: 0 }}>
      {children}
    </Text>
  );
  if (!error) return text;
  return (
    <Group gap={4} wrap="nowrap" align="flex-start">
      {text}
      <CopyButton text={() => children} />
    </Group>
  );
}
