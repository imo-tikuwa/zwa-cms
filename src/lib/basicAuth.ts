import { invoke } from "@tauri-apps/api/core";

/** The user name while the site is behind Basic authentication. */
export const getBasicAuth = () => invoke<string | null>("basic_auth_get");

export const setBasicAuth = (user: string, password: string) => invoke<void>("basic_auth_set", { user, password });

export const clearBasicAuth = () => invoke<void>("basic_auth_clear");
