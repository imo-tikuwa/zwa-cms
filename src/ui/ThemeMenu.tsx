import { useState } from "react";
import { Monitor, Moon, Sun, SunDim, SunMedium } from "lucide-react";
import { Brightness, Theme, ThemeMode, loadTheme, saveTheme } from "../lib/theme";
import { Menu } from "./Menu";

const MODES: { mode: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { mode: "system", label: "OS の設定に合わせる", icon: <Monitor size={14} /> },
  { mode: "light", label: "ライト", icon: <Sun size={14} /> },
  { mode: "dark", label: "ダーク", icon: <Moon size={14} /> },
];

const BRIGHTNESS: { value: Brightness; label: string }[] = [
  { value: -1, label: "暗め" },
  { value: 0, label: "標準" },
  { value: 1, label: "明るめ" },
];

/** Title bar button to switch light/dark and brightness. */
export function ThemeMenu() {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const update = (patch: Partial<Theme>) => {
    const next = { ...theme, ...patch };
    setTheme(next);
    saveTheme(next);
  };
  const icon = theme.mode === "dark" ? <Moon size={15} /> : theme.mode === "light" ? <Sun size={15} /> : <SunMedium size={15} />;

  return (
    <Menu
      compact
      icon={icon}
      title="表示テーマ"
      label=""
      items={[
        { kind: "heading", key: "h-mode", label: "テーマ" },
        ...MODES.map((m) => ({
          key: m.mode,
          label: m.label,
          icon: m.icon,
          checked: theme.mode === m.mode,
          onSelect: () => update({ mode: m.mode }),
        })),
        { kind: "separator" as const, key: "sep" },
        { kind: "heading", key: "h-brightness", label: "明るさ" },
        ...BRIGHTNESS.map((b) => ({
          key: `b${b.value}`,
          label: b.label,
          icon: <SunDim size={14} />,
          checked: theme.brightness === b.value,
          onSelect: () => update({ brightness: b.value }),
        })),
      ]}
    />
  );
}
