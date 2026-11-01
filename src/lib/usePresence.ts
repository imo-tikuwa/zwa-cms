import { useEffect, useState } from "react";

/**
 * Keeps something mounted for `ms` after it is closed, so it can play a
 * closing animation. `leaving` is true during that time.
 */
export function usePresence(open: boolean, ms = 200) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), ms);
    return () => window.clearTimeout(timer);
  }, [open, ms]);
  return { mounted: open || mounted, leaving: !open && mounted };
}
