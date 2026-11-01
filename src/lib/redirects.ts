import { invoke } from "@tauri-apps/api/core";

export type Redirect = { id: number; from_path: string; to_path: string; status_code: 301 | 302 };
export type RedirectInput = Omit<Redirect, "id"> & { id: number | null };

export const listRedirects = () => invoke<Redirect[]>("redirects_list");
export const saveRedirect = (input: RedirectInput) => invoke<void>("redirect_save", { input });
export const deleteRedirect = (id: number) => invoke<void>("redirect_delete", { id });
