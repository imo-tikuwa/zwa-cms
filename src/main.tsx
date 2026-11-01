import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import { DatesProvider } from "@mantine/dates";
import "dayjs/locale/ja";
// Bundled so the UI looks the same on every PC (Windows lacks it).
import "@fontsource-variable/noto-sans-jp";
import App from "./App";
import { applyTheme, loadTheme, onThemeChange, resolveScheme } from "./lib/theme";
import { theme } from "./ui/mantineTheme";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { LockGate } from "./ui/LockGate";
import { ToastHost } from "./ui/Toast";
import { forwardConsoleToLog } from "./lib/log";
import { syncPreviewAppearance } from "./lib/preview";

forwardConsoleToLog();

if (import.meta.env.DEV) document.documentElement.dataset.dev = "";

// Before the first render, so the window does not flash the wrong theme.
applyTheme(loadTheme());
syncPreviewAppearance();

/** Light/dark comes from the title bar menu (src/lib/theme.ts), not Mantine. */
function Root() {
  const [scheme, setScheme] = useState(() => resolveScheme(loadTheme()));
  useEffect(() => onThemeChange(() => setScheme(resolveScheme(loadTheme()))), []);
  return (
    <MantineProvider theme={theme} forceColorScheme={scheme}>
      <DatesProvider settings={{ locale: "ja", firstDayOfWeek: 0, weekendDays: [0, 6] }}>
        <ErrorBoundary>
          <LockGate>
            <App />
          </LockGate>
        </ErrorBoundary>
        <ToastHost />
      </DatesProvider>
    </MantineProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
