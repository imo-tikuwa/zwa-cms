import { invoke } from "@tauri-apps/api/core";

export type ThemeFile = { path: string; size: number; sha256: string };
export type ThemeStatus = { files: ThemeFile[]; dev_dir: string | null };

export const themeStatus = () => invoke<ThemeStatus>("theme_status");
export const exportDefaultTheme = (dir: string) => invoke<string>("theme_export_default", { dir });
export const uploadTheme = (dir: string) => invoke<ThemeStatus>("theme_upload", { dir });
export const resetTheme = () => invoke<ThemeStatus>("theme_reset");
export const setThemeDevDir = (dir: string | null) => invoke<ThemeStatus>("theme_set_dev_dir", { dir });
