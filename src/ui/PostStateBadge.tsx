import { Badge, Tooltip } from "@mantine/core";
import { POST_STATE_LABELS, PostState, stateHint } from "../lib/publishStatus";

const LOOKS: Record<PostState, { variant: string; color?: string }> = {
  draft: { variant: "outline", color: "gray" },
  scheduled: { variant: "light", color: "blue" },
  pending: { variant: "outline" },
  live: { variant: "light", color: "green" },
};

/** 下書き / 予約 / 未反映 / 公開中, with what it means on hover. */
export function PostStateBadge({
  state,
  scheduling,
  className,
}: {
  state: PostState;
  /** Scheduled posts are on (GitHub link); changes the hint of 予約. */
  scheduling: boolean | null;
  className?: string;
}) {
  const { label } = POST_STATE_LABELS[state];
  return (
    <Tooltip label={stateHint(state, scheduling)}>
      <Badge {...LOOKS[state]} className={className} style={{ flexShrink: 0 }}>
        {label}
      </Badge>
    </Tooltip>
  );
}
