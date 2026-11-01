import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { CircleAlert, CircleCheck, Info } from "lucide-react";

/**
 * Small confirmations at the bottom right ("保存しました"), modelled on the
 * feel of React Bits' Swipe Toast (written from scratch; React Bits' own code
 * is not MIT-only). A card slides up, a fuse in the accent color burns
 * down for the time left, hovering pauses it, and it can be flicked or
 * dragged down to dismiss; dragged up, it resists. Errors stay on the screen
 * that caused them (src/ui/Alert.tsx).
 */

export type ToastLevel = "success" | "info" | "error";
export type ToastOptions = {
  /** A second, dimmer line. */
  description?: string;
  level?: ToastLevel;
  duration?: number;
  /** A small button, e.g. "元に戻す". */
  action?: { label: string; onClick: () => void };
};
type Item = ToastOptions & { id: number; title: string; level: ToastLevel; duration: number };

const DURATION = 4000;
const MAX = 4;
const SLIDE_MS = 400;
const COLLAPSE_MS = 200;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
/** px/ms: a flick this fast dismisses regardless of distance. */
const FLICK = 0.11;
const SWIPE_DISTANCE = 40;
const DEAD_ZONE = 3;
/** How far an upward drag can stretch. */
const RESIST_PX = 24;

let items: Item[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

/** Shows a toast; the same title again replaces the earlier one. */
export function toast(title: string, options: ToastOptions = {}) {
  const item: Item = {
    ...options,
    id: nextId++,
    title,
    level: options.level ?? "success",
    duration: options.duration ?? DURATION,
  };
  items = [...items.filter((t) => t.title !== title), item].slice(-MAX);
  emit();
}

const remove = (id: number) => {
  items = items.filter((t) => t.id !== id);
  emit();
};

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/** Renders the toasts; mounted once at the root. */
export function ToastHost() {
  const list = useSyncExternalStore(subscribe, () => items);
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <ToastCard key={t.id} item={t} />
      ))}
    </div>
  );
}

const ICONS = {
  success: <CircleCheck size={18} />,
  info: <Info size={18} />,
  error: <CircleAlert size={18} />,
};

/** Pulls `over` back toward 0 the further it goes (iOS-style overscroll). */
const rubberband = (over: number, dim: number, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));

type Phase = "open" | "closing" | "collapsing";

function ToastCard({ item }: { item: Item }) {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("open");
  const card = useRef<HTMLDivElement>(null);
  const fuse = useRef<HTMLElement>(null);
  const burn = useRef<Animation | null>(null);
  const pause = useRef({ hover: false, drag: false, hidden: false });
  const drag = useRef<{ id: number; startY: number; grab: number | null; hist: [number, number][] } | null>(null);
  const y = useMotionValue(0);
  const fade = useMotionValue(1);
  const transform = useTransform(y, (v) => `translateY(${v}px)`);

  const syncFuse = () => {
    const a = burn.current;
    if (!a) return;
    const p = pause.current;
    if (p.hover || p.drag || p.hidden) a.pause();
    else if (a.playState === "paused") a.play();
  };

  /** Shrinks the slot so the toasts above slide down, then removes it. */
  const collapse = () => {
    setPhase("collapsing");
    window.setTimeout(() => remove(item.id), COLLAPSE_MS);
  };

  const close = () => {
    if (phase !== "open") return;
    burn.current?.pause();
    setPhase("closing");
    window.setTimeout(collapse, SLIDE_MS * 0.7 + 60);
  };

  useEffect(() => {
    if (!fuse.current) return;
    const a = fuse.current.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
      duration: item.duration,
      easing: "linear",
      fill: "forwards",
    });
    a.onfinish = close;
    burn.current = a;
    const onVisibility = () => {
      pause.current.hidden = document.hidden;
      syncFuse();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      a.onfinish = null;
      a.cancel();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const swipeOut = (dy: number, velocity: number) => {
    burn.current?.pause();
    if (!reduce && card.current) {
      animate(y, dy + card.current.offsetHeight, { type: "spring", duration: 0.3, bounce: 0, velocity: velocity * 1000 });
    }
    animate(fade, 0, { duration: 0.2, ease: EASE_OUT }).then(collapse);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || phase !== "open" || (e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    y.stop();
    drag.current = { id: e.pointerId, startY: e.clientY, grab: null, hist: [[performance.now(), y.get()]] };
    pause.current.drag = true;
    syncFuse();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (d.grab === null) {
      if (Math.abs(e.clientY - d.startY) < DEAD_ZONE) return;
      d.grab = e.clientY - y.get();
      card.current?.setAttribute("data-swiping", "");
    }
    const raw = e.clientY - d.grab;
    const next = raw >= 0 ? raw : rubberband(raw, RESIST_PX);
    y.set(next);
    d.hist.push([performance.now(), next]);
    if (d.hist.length > 4) d.hist.shift();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    card.current?.removeAttribute("data-swiping");
    pause.current.drag = false;
    const dy = y.get();
    const [t0, y0] = d.hist[0];
    const [t1, y1] = d.hist[d.hist.length - 1];
    const velocity = performance.now() - t1 > 100 ? 0 : (y1 - y0) / Math.max(1, t1 - t0);
    if (dy > 0 && (velocity > FLICK || (dy >= SWIPE_DISTANCE && velocity >= 0))) {
      swipeOut(dy, velocity);
      return;
    }
    if (d.grab !== null) {
      animate(
        y,
        0,
        reduce ? { duration: 0.2, ease: EASE_OUT } : { type: "spring", duration: 0.5, bounce: 0.2, velocity: velocity * 1000 },
      );
    }
    syncFuse();
  };

  return (
    <div className="toast-slot" data-phase={phase}>
      <div className="toast-gate">
        <div className="toast-lift">
          <motion.div
            ref={card}
            className={`toast toast-${item.level}`}
            role={item.level === "error" ? "alert" : "status"}
            style={{ transform, opacity: fade }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerEnter={(e) => {
              if (e.pointerType !== "mouse") return;
              pause.current.hover = true;
              syncFuse();
            }}
            onPointerLeave={(e) => {
              if (e.pointerType !== "mouse") return;
              pause.current.hover = false;
              syncFuse();
            }}
          >
            <span className="toast-icon">{ICONS[item.level]}</span>
            <span className="toast-body">
              <span className="toast-title">{item.title}</span>
              {item.description && <span className="toast-desc">{item.description}</span>}
            </span>
            {item.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  item.action!.onClick();
                  close();
                }}
              >
                {item.action.label}
              </button>
            )}
            <i ref={fuse} className="toast-fuse" aria-hidden="true" />
          </motion.div>
        </div>
      </div>
    </div>
  );
}
