/**
 * Appearance (light/dark and brightness). A per-machine preference, kept
 * in localStorage and applied as data attributes on <html> before React
 * renders so the window does not flash.
 */

export type ThemeMode = "system" | "light" | "dark";
/** -1 = darker, 0 = standard, 1 = brighter. */
export type Brightness = -1 | 0 | 1;

export type Theme = { mode: ThemeMode; brightness: Brightness };

const KEY = "zwa.theme";
const DEFAULT: Theme = { mode: "system", brightness: 0 };

export function loadTheme(): Theme {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (saved && ["system", "light", "dark"].includes(saved.mode) && [-1, 0, 1].includes(saved.brightness)) {
      return saved;
    }
  } catch {
    // Fall back to the default.
  }
  return DEFAULT;
}

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

/** Light or dark after following the OS for "system". */
export const resolveScheme = (theme: Theme): "light" | "dark" =>
  theme.mode === "system" ? (darkQuery().matches ? "dark" : "light") : theme.mode;

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme.mode === "system") delete root.dataset.theme;
  else root.dataset.theme = theme.mode;
  root.dataset.brightness = String(theme.brightness);
  // Mantine reads this too; set it here so the first paint is right.
  root.dataset.mantineColorScheme = resolveScheme(theme);
  window.dispatchEvent(new Event(CHANGE));
}

const CHANGE = "zwa-theme-change";

/** Calls back when the theme or the OS color scheme changes. */
export function onThemeChange(callback: () => void) {
  const query = darkQuery();
  window.addEventListener(CHANGE, callback);
  query.addEventListener("change", callback);
  return () => {
    window.removeEventListener(CHANGE, callback);
    query.removeEventListener("change", callback);
  };
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, JSON.stringify(theme));
  } catch {
    // Not fatal: the choice just won't persist.
  }
  applyTheme(theme);
}
