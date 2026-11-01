import { invoke } from "@tauri-apps/api/core";

/** The app lock (Windows Hello), per PC. See src-tauri/src/lock. */
export type LockStatus = {
  /** Windows Hello is set up on this PC. */
  supported: boolean;
  enabled: boolean;
  locked: boolean;
  /** Minutes without use before locking; 0 = only when the app starts. */
  minutes: number;
};

export const lockStatus = () => invoke<LockStatus>("lock_status");
export const enableLock = () => invoke<void>("lock_enable");
export const disableLock = () => invoke<void>("lock_disable");
export const unlock = () => invoke<void>("lock_unlock");
export const lockNow = () => invoke<void>("lock_now");
export const setLockMinutes = (minutes: number) => invoke<void>("lock_set_minutes", { minutes });
/** Deletes the token and API key and turns the lock off (when Windows Hello cannot open them). */
export const resetLock = () => invoke<void>("lock_reset");

export const LOCK_MINUTES = [5, 10, 30, 60, 0] as const;
export const lockMinutesLabel = (m: number) => (m === 0 ? "起動したときだけ" : `${m} 分`);

// Tells the lock gate (src/ui/LockGate.tsx) that the settings changed.
const listeners = new Set<() => void>();
export const onLockChange = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
export const notifyLockChange = () => listeners.forEach((fn) => fn());
