import { invoke } from "@tauri-apps/api/core";

export type SiteSettings = Record<string, string>;

export const getSiteSettings = () => invoke<SiteSettings>("site_settings_get");

export const saveSiteSettings = (values: SiteSettings) => invoke<void>("site_settings_save", { values });
