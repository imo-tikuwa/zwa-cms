import { invoke } from "@tauri-apps/api/core";

/** This PC's window behavior (stored in the app's local settings). */
export type WindowPrefs = { quit_on_close: boolean; notify_off: boolean; sound_off: boolean };

export const windowPrefs = () => invoke<WindowPrefs>("window_prefs_get");
export const setWindowPrefs = (prefs: WindowPrefs) => invoke<void>("window_prefs_set", { prefs });
export const quitApp = () => invoke<void>("app_quit");
/** Opens the app's log folder in the file manager. */
export const openLogDir = () => invoke<void>("log_dir_open");

/** The system sound for a dialog (Windows only; off in the app settings). */
export const playSound = (kind: "warning" | "info") => void invoke<void>("play_sound", { kind }).catch(() => {});
