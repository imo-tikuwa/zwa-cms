import { ActionIcon } from "@mantine/core";
import { Settings } from "lucide-react";
import appIcon from "../../src-tauri/icons/64x64.png";
import { ThemeMenu } from "./ThemeMenu";
import { WindowControls } from "./WindowControls";

/** Draggable title bar that replaces the OS one. */
export function TitleBar({ subtitle, onOpenSettings }: { subtitle?: string; onOpenSettings?: () => void }) {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <img src={appIcon} alt="" className="titlebar-icon" data-tauri-drag-region />
      <span className="titlebar-title" data-tauri-drag-region>
        ZWA CMS
        {subtitle && <span className="titlebar-subtitle"> — {subtitle}</span>}
      </span>
      {onOpenSettings && (
        <ActionIcon variant="subtle" color="gray" size="lg" title="アプリの設定" aria-label="アプリの設定" onClick={onOpenSettings}>
          <Settings size={16} />
        </ActionIcon>
      )}
      <ThemeMenu />
      <WindowControls />
    </header>
  );
}
