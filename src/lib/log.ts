import { error, warn } from "@tauri-apps/plugin-log";

const one = (a: unknown) =>
  a instanceof Error ? (a.stack ?? a.message) : typeof a === "string" ? a : safeJson(a);

/** Joins console arguments, filling in `%s`-style placeholders as the console does. */
function text(args: unknown[]) {
  const [first, ...rest] = args;
  if (typeof first === "string" && first.includes("%")) {
    const filled = first.replace(/%[sdifoOc%]/g, (p) => {
      if (p === "%%") return "%";
      const value = rest.shift();
      return p === "%c" ? "" : one(value);
    });
    return [filled, ...rest.map(one)].join(" ");
  }
  return args.map(one).join(" ");
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Sends the webview's errors and warnings to the app log (the terminal and the
 * log file, see src-tauri/src/lib.rs), so they are not lost when DevTools is closed.
 */
export function forwardConsoleToLog() {
  // Logging must never fail or recurse into console.error.
  const send = (fn: typeof error, message: string) => void fn(message).catch(() => {});

  for (const [level, fn] of [
    ["error", error],
    ["warn", warn],
  ] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      send(fn, `[webview] ${text(args)}`);
    };
  }
  window.addEventListener("error", (e) => send(error, `[webview] uncaught: ${text([e.error ?? e.message])}`));
  window.addEventListener("unhandledrejection", (e) => send(error, `[webview] unhandled rejection: ${text([e.reason])}`));
}
