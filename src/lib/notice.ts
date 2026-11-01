/** Top-of-screen notices the user can hide for this launch or for good. */

/** Whether the notice is hidden (this launch: session, for good: local). */
export function noticeDismissed(key: string) {
  try {
    return sessionStorage.getItem(key) === "1" || localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function dismissNotice(key: string, forever: boolean) {
  try {
    (forever ? localStorage : sessionStorage).setItem(key, "1");
  } catch {
    // Not fatal: the notice comes back next time.
  }
}
