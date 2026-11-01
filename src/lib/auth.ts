import { invoke } from "@tauri-apps/api/core";

export type Account = { id: string; name: string };

export type AuthStatus = {
  method: "api_token" | null;
  accounts: Account[];
  account_id: string | null;
};

export const authStatus = () => invoke<AuthStatus>("auth_status");

export const signInWithToken = (token: string) =>
  invoke<AuthStatus>("auth_sign_in_with_token", { token });

export const selectAccount = (accountId: string) =>
  invoke<void>("auth_select_account", { accountId });

export const signOut = () => invoke<void>("auth_sign_out");

/** Where users create and edit Cloudflare API tokens. */
export const TOKEN_PAGE = "https://dash.cloudflare.com/profile/api-tokens";
