import { invoke } from "@tauri-apps/api/core";
import { whileBusy } from "./busy";
import { loadTheme, onThemeChange, resolveScheme } from "./theme";

export type PreviewResult = { url: string; files: number; warnings: string[] };

export const buildPreview = () => invoke<PreviewResult>("preview_build");

export const previewUrl = () => invoke<string | null>("preview_url");

export type PublishResult = { url: string; files: number; uploaded: number; warnings: string[] };

/** The busy label while publishing; other screens hold back conflicting actions. */
export const PUBLISHING = "サイトの公開";
export const publishSite = () => whileBusy(PUBLISHING, () => invoke<PublishResult>("site_publish"));

/** Keeps preview pages in the app's light/dark and brightness (they poll for it). */
export function syncPreviewAppearance() {
  const send = () => {
    const theme = loadTheme();
    void invoke("preview_set_appearance", {
      appearance: { mode: theme.mode, brightness: theme.brightness, scheme: resolveScheme(theme) },
    }).catch(() => {});
  };
  send();
  return onThemeChange(send);
}
