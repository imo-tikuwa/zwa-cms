//! System tray: closing the window hides it to the tray so the preview
//! server and AI requests keep running. "終了" in the tray menu quits the
//! app. With `quit_on_close`, closing quits instead (after the UI confirms
//! that nothing is in progress) and the tray icon is hidden.

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_notification::NotificationExt;

use crate::error::Result;
use crate::settings;

const TRAY_ID: &str = "main";
/// Sent to the UI when the window is closed with `quit_on_close`.
const EVENT_CLOSE_REQUESTED: &str = "close-requested";

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "ZWA CMS を開く", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("ZWA CMS")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    let tray = tray.build(app)?;
    if quit_on_close(app) {
        tray.set_visible(false)?;
    }
    Ok(())
}

fn quit_on_close(app: &AppHandle) -> bool {
    settings::load(app).is_ok_and(|s| s.quit_on_close)
}

/// Hide the main window instead of closing it, or let the UI decide
/// whether to quit (it asks first when work would be lost).
pub fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event
        && window.label() == "main"
    {
        api.prevent_close();
        if quit_on_close(window.app_handle()) {
            let _ = window.app_handle().emit(EVENT_CLOSE_REQUESTED, ());
        } else {
            let _ = window.hide();
        }
    }
}

/// Shows a desktop notification (AI or publishing finished) if the main
/// window is hidden or minimized
/// (and notifications are not turned off).
pub fn notify_if_hidden(app: &AppHandle, title: &str, body: &str) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let hidden = !window.is_visible().unwrap_or(true) || window.is_minimized().unwrap_or(false);
    if !hidden || settings::load(app).is_ok_and(|s| s.notify_off) {
        return;
    }
    let _ = app.notification().builder().title(title).body(body).show();
}

#[derive(Serialize, Deserialize)]
pub struct WindowPrefs {
    quit_on_close: bool,
    notify_off: bool,
    #[serde(default)]
    sound_off: bool,
}

#[tauri::command]
pub fn window_prefs_get(app: AppHandle) -> Result<WindowPrefs> {
    let s = settings::load(&app)?;
    Ok(WindowPrefs {
        quit_on_close: s.quit_on_close,
        notify_off: s.notify_off,
        sound_off: s.sound_off,
    })
}

#[tauri::command]
pub fn window_prefs_set(app: AppHandle, prefs: WindowPrefs) -> Result<()> {
    let mut s = settings::load(&app)?;
    s.quit_on_close = prefs.quit_on_close;
    s.notify_off = prefs.notify_off;
    s.sound_off = prefs.sound_off;
    settings::save(&app, &s)?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_visible(!prefs.quit_on_close)?;
    }
    Ok(())
}

/// Plays the system sound for a dialog: `warning` (Windows' "Exclamation")
/// or `info` ("Asterisk"), as message boxes do. Silent elsewhere or when
/// turned off.
#[tauri::command]
pub fn play_sound(app: AppHandle, kind: String) {
    if settings::load(&app).is_ok_and(|s| s.sound_off) {
        return;
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Diagnostics::Debug::MessageBeep;
        use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONASTERISK, MB_ICONWARNING};
        let style = if kind == "warning" {
            MB_ICONWARNING
        } else {
            MB_ICONASTERISK
        };
        // SAFETY: MessageBeep takes a plain flag and only queues a sound.
        unsafe {
            MessageBeep(style);
        }
    }
    #[cfg(not(windows))]
    let _ = kind;
}

/// Opens the folder the log plugin writes to (see `lib.rs`).
#[tauri::command]
pub fn log_dir_open(app: AppHandle) -> crate::error::Result<()> {
    let dir = app.path().app_log_dir()?;
    std::fs::create_dir_all(&dir)?;
    tauri_plugin_opener::open_path(&dir, None::<&str>).map_err(|e| crate::error::Error::Invalid(e.to_string()))
}

/// Quits after the UI has confirmed (see `on_window_event`).
#[tauri::command]
pub fn app_quit(app: AppHandle) {
    app.exit(0);
}
