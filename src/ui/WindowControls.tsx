import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";

/**
 * Minimize / maximize / close. The OS title bar is hidden
 * (decorations: false), so the app draws its own. Closing hides the
 * window to the tray or quits, per the app settings (see
 * src-tauri/src/tray.rs).
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const refresh = () => void win.isMaximized().then((v) => !disposed && setMaximized(v)).catch(() => {});
    refresh();
    void win.onResized(refresh).then((off) => (disposed ? off() : (unlisten = off)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const win = getCurrentWindow();
  return (
    <div className="window-controls">
      <button type="button" title="最小化" onClick={() => void win.minimize()}>
        <Minus size={15} />
      </button>
      <button type="button" title={maximized ? "元のサイズに戻す" : "最大化"} onClick={() => void win.toggleMaximize()}>
        {maximized ? <Copy size={12} style={{ transform: "scaleX(-1)" }} /> : <Square size={12} />}
      </button>
      <button type="button" className="close" title="閉じる" onClick={() => void win.close()}>
        <X size={16} />
      </button>
    </div>
  );
}
