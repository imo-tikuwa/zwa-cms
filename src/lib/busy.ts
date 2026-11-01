// Work in progress that quitting would interrupt, so closing the window can
// ask first (when the app is set to quit on close instead of staying in the
// tray).

import { useEffect, useState } from "react";

const running = new Map<string, number>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Marks `label` as running until the returned function is called. */
export function trackBusy(label: string): () => void {
  running.set(label, (running.get(label) ?? 0) + 1);
  notify();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const n = (running.get(label) ?? 1) - 1;
    if (n > 0) running.set(label, n);
    else running.delete(label);
    notify();
  };
}

export const busyLabels = () => [...running.keys()];

/** Whether `label` is running, re-rendering when that changes. */
export function useBusy(label: string) {
  const [busy, setBusy] = useState(() => running.has(label));
  useEffect(() => {
    const update = () => setBusy(running.has(label));
    listeners.add(update);
    update();
    return () => void listeners.delete(update);
  }, [label]);
  return busy;
}

/** Runs `task` while it is marked as busy. */
export async function whileBusy<T>(label: string, task: () => Promise<T>): Promise<T> {
  const release = trackBusy(label);
  try {
    return await task();
  } finally {
    release();
  }
}
