import { invoke } from "@tauri-apps/api/core";

export type GitHubStatus = {
  /** `owner/name` when linked. */
  repo: string | null;
  /** The scheduler Worker's name when scheduled posts are on. */
  schedule: string | null;
  /** The site has been published (the scheduler needs that first). */
  published: boolean;
  /** Forms are on (the Actions token gets Turnstile too). */
  forms: boolean;
  dispatched_at: string | null;
  dispatch_error: string | null;
  /** Before linking: the Cloudflare token has the Account API Tokens permission. */
  can_make_tokens: boolean | null;
};

export const githubStatus = () => invoke<GitHubStatus>("github_status");
/** `repo` is `owner/name`, or just the name for the token's own account. */
export const githubLink = (token: string, repo: string) => invoke<GitHubStatus>("github_link", { token, repo });
export const githubUnlink = () => invoke<GitHubStatus>("github_unlink");

/** Shown when the user's Cloudflare token cannot make the Actions token. */
export const TOKENS_PERMISSION = "Account · Account API Tokens · Edit";

/** The template repository the site's repository is made from (a separate repository). */
export const TEMPLATE_REPO = "imo-tikuwa/zwa-cms-site-template";
const [templateOwner, templateName] = TEMPLATE_REPO.split("/");

/** GitHub's new-repository form, filled in with the template, the name and private. */
export const newRepoUrl = (name: string) =>
  `https://github.com/new?template_owner=${templateOwner}&template_name=${templateName}&name=${encodeURIComponent(name)}&visibility=private`;

// GitHub fills in the new-token form from these (the repositories have to be picked there).
const NEW_TOKEN = "https://github.com/settings/personal-access-tokens/new";
export const TOKENS_PAGE = "https://github.com/settings/personal-access-tokens";
/** One per site: each site's scheduler Worker keeps its own, and GitHub shows a token only once. */
export const tokenName = (repo: string) => `ZWA CMS ${repo.split("/").pop()}`.slice(0, 40);
export const tokenUrl = (repo: string) =>
  `${NEW_TOKEN}?name=${encodeURIComponent(tokenName(repo))}&expires_in=none&actions=write&secrets=write`;

export type TokenCheck = {
  login: string;
  fine_grained: boolean;
  expires_at: string | null;
};

export const githubCheckToken = (token: string) => invoke<TokenCheck>("github_check_token", { token });
