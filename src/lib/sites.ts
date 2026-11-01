import { invoke } from "@tauri-apps/api/core";

export type Site = {
  id: string;
  title: string;
  account_id: string;
  d1_database_id: string;
  d1_database_name: string;
  r2_bucket: string;
  worker_name: string;
};

export type SitesState = { sites: Site[]; current_site: string | null };

export type D1Database = { uuid: string; name: string };

export const sitesState = () => invoke<SitesState>("sites_state");

/** Applies pending D1 migrations to the current site (once per app session). */
export const migrateSite = () => invoke<void>("site_migrate");

export const selectSite = (databaseId: string) =>
  invoke<SitesState>("site_select", { databaseId });

export const forgetSite = (databaseId: string) =>
  invoke<SitesState>("site_forget", { databaseId });

/** Deletes the current site's Cloudflare resources and forgets it. */
export const deleteSite = (siteId: string) =>
  invoke<{ state: SitesState; warnings: string[] }>("site_delete", { siteId });

export const createSite = (siteId: string, title: string) =>
  invoke<SitesState>("site_create", { siteId, title });

export const connectCandidates = () => invoke<D1Database[]>("site_connect_candidates");

export const connectSite = (databaseId: string) =>
  invoke<SitesState>("site_connect", { databaseId });

// Mirrors validate_site_id / ResourceNames in src-tauri/src/sites.rs.
export const SITE_ID_PATTERN = /^[a-z](?!.*--)[a-z0-9-]{0,30}[a-z0-9]$/;

export const resourceNames = (siteId: string) => ({
  d1: `zwa-${siteId}`,
  r2: `zwa-${siteId}-media`,
  worker: `zwa-${siteId}`,
});
