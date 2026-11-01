import { useState } from "react";

const KEY = "zwa.sidebarWidth";
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 360;
const SIDEBAR_DEFAULT = 232;

const clamp = (w: number) => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)));

/** Sidebar width, remembered per PC in localStorage. */
export function useSidebarWidth() {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(KEY));
      return saved ? clamp(saved) : SIDEBAR_DEFAULT;
    } catch {
      return SIDEBAR_DEFAULT;
    }
  });
  const set = (w: number) => {
    const next = clamp(w);
    setWidth(next);
    try {
      localStorage.setItem(KEY, String(next));
    } catch {
      // Not remembered; the width still applies until restart.
    }
  };
  return [width, set] as const;
}

type Props = { width: number; onChange: (width: number) => void };

/** Drag handle on the sidebar's right edge. Double-click restores the default width. */
export function SidebarResizer({ width, onChange }: Props) {
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    setDragging(true);
    const move = (ev: PointerEvent) => onChange(startWidth + ev.clientX - startX);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setDragging(false);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 10;
    if (e.key === "ArrowLeft") onChange(width - step);
    else if (e.key === "ArrowRight") onChange(width + step);
    else return;
    e.preventDefault();
  };

  return (
    <div
      className="sidebar-resizer"
      data-dragging={dragging || undefined}
      role="separator"
      aria-orientation="vertical"
      aria-label="左側の欄の幅"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={width}
      tabIndex={0}
      title="ドラッグで幅を変更（ダブルクリックで元の幅）"
      onPointerDown={onPointerDown}
      onDoubleClick={() => onChange(SIDEBAR_DEFAULT)}
      onKeyDown={onKeyDown}
    />
  );
}
