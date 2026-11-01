//! Windows Hello: an app key in the TPM that signs only after the user
//! verifies (PIN, face or fingerprint). The signature of a fixed challenge is
//! the secret the vault key is derived from (RSA PKCS#1 v1.5 signatures are
//! deterministic; `lock_unlock` refuses a key that cannot open the secrets).
//!
//! `owner` is the app window: the dialog cannot be given an owner, so we try
//! to move it over that window once it appears (it opens on the main monitor).
//! The dialog belongs to a more privileged process (CredentialUIBroker), so
//! Windows may refuse the move (access denied); then it stays where it is.

use std::time::{Duration, Instant};

use windows::Security::Credentials::{
    KeyCredential, KeyCredentialCreationOption, KeyCredentialManager, KeyCredentialStatus,
};
use windows::Security::Cryptography::CryptographicBuffer;
use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize};
use windows::core::{Array, HSTRING};
use windows_sys::Win32::Foundation::RECT;
use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    FindWindowW, GetWindowRect, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER, SetForegroundWindow, SetWindowPos,
};

const KEY_NAME: &str = "zwa-cms";
const CHALLENGE: &[u8] = b"zwa-cms vault v1";

pub fn is_supported() -> bool {
    in_mta(|| {
        KeyCredentialManager::IsSupportedAsync()
            .and_then(|op| op.join())
            .unwrap_or(false)
    })
}

/// Creates (or replaces) the app key and returns the challenge signature.
/// Windows usually asks once (signing right after creating does not ask again).
pub fn create(owner: isize) -> Result<Vec<u8>, String> {
    in_mta(move || create_key(owner))
}

fn create_key(owner: isize) -> Result<Vec<u8>, String> {
    let result = with_dialog_over(owner, || {
        KeyCredentialManager::RequestCreateAsync(
            &HSTRING::from(KEY_NAME),
            KeyCredentialCreationOption::ReplaceExisting,
        )?
        .join()
    })
    .map_err(|e| e.message())?;
    check(result.Status().map_err(|e| e.message())?)?;
    sign(owner, &result.Credential().map_err(|e| e.message())?)
}

/// Asks the user to verify and returns the challenge signature.
pub fn unlock(owner: isize) -> Result<Vec<u8>, String> {
    in_mta(move || open_and_sign(owner))
}

fn open_and_sign(owner: isize) -> Result<Vec<u8>, String> {
    let result = KeyCredentialManager::OpenAsync(&HSTRING::from(KEY_NAME))
        .and_then(|op| op.join())
        .map_err(|e| e.message())?;
    check(result.Status().map_err(|e| e.message())?)?;
    sign(owner, &result.Credential().map_err(|e| e.message())?)
}

pub fn delete() -> Result<(), String> {
    in_mta(|| {
        KeyCredentialManager::DeleteAsync(&HSTRING::from(KEY_NAME))
            .and_then(|op| op.join())
            .map_err(|e| e.message())
    })
}

/// Runs WinRT calls on a thread of their own that joins the multithreaded
/// apartment (Tauri's and tokio's threads are not set up for WinRT).
fn in_mta<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    std::thread::spawn(move || {
        // SAFETY: paired with RoUninitialize on this same thread.
        let initialized = unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.is_ok();
        let result = f();
        if initialized {
            // SAFETY: RoInitialize succeeded on this thread.
            unsafe { RoUninitialize() };
        }
        result
    })
    .join()
    .expect("Windows Hello thread panicked")
}

fn sign(owner: isize, credential: &KeyCredential) -> Result<Vec<u8>, String> {
    let data = CryptographicBuffer::CreateFromByteArray(CHALLENGE).map_err(|e| e.message())?;
    let result = with_dialog_over(owner, || credential.RequestSignAsync(&data)?.join())
        .map_err(|e| e.message())?;
    check(result.Status().map_err(|e| e.message())?)?;
    let mut bytes = Array::<u8>::new();
    CryptographicBuffer::CopyToByteArray(&result.Result().map_err(|e| e.message())?, &mut bytes)
        .map_err(|e| e.message())?;
    Ok(bytes.to_vec())
}

fn check(status: KeyCredentialStatus) -> Result<(), String> {
    match status {
        KeyCredentialStatus::Success => Ok(()),
        KeyCredentialStatus::UserCanceled => Err("Windows Hello の確認が取り消されました".into()),
        KeyCredentialStatus::NotFound => Err(
            "Windows Hello の鍵が見つかりません。アプリの設定でロックをいったんオフにして、もう一度オンにしてください".into(),
        ),
        KeyCredentialStatus::UserPrefersPassword => Err("Windows Hello の代わりにパスワードが選ばれました".into()),
        KeyCredentialStatus::SecurityDeviceLocked => Err(
            "セキュリティデバイスがロックされています。しばらく待ってからもう一度お試しください".into(),
        ),
        _ => Err("Windows Hello で確認できませんでした".into()),
    }
}

/// Runs a blocking Windows Hello call while moving its dialog over the app
/// window and bringing it forward.
fn with_dialog_over<T>(owner: isize, call: impl FnOnce() -> windows::core::Result<T>) -> windows::core::Result<T> {
    let done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let watcher = {
        let done = done.clone();
        std::thread::spawn(move || {
            let class: Vec<u16> = "Credential Dialog Xaml Host\0".encode_utf16().collect();
            let started = Instant::now();
            let mut found = false;
            let mut moves = 0;
            let mut refused = false;
            // The dialog places itself (on the main monitor) after it appears,
            // possibly more than once, so keep putting it back while it is open.
            while !done.load(std::sync::atomic::Ordering::Relaxed) && started.elapsed() < Duration::from_secs(120) {
                // SAFETY: a NUL-terminated class name and a null window name.
                let hwnd = unsafe { FindWindowW(class.as_ptr(), std::ptr::null()) };
                if !hwnd.is_null() {
                    if !found {
                        found = true;
                        log::debug!("lock: Windows Hello dialog appeared after {:?}", started.elapsed());
                        // SAFETY: hwnd was just returned by FindWindowW.
                        unsafe { SetForegroundWindow(hwnd) };
                    }
                    if !refused && moves < 20 {
                        match move_over(hwnd, owner as _) {
                            Ok(true) => moves += 1,
                            Ok(false) => {}
                            Err(e) => {
                                // Retrying cannot help; leave it where Windows put it.
                                log::debug!("lock: Windows Hello dialog cannot be moved: {e}");
                                refused = true;
                            }
                        }
                    }
                }
                std::thread::sleep(Duration::from_millis(if found { 100 } else { 30 }));
            }
            if !found {
                log::info!("lock: Windows Hello dialog window not found");
            }
        })
    };
    let result = call();
    done.store(true, std::sync::atomic::Ordering::Relaxed);
    let _ = watcher.join();
    result
}

/// Centers `dialog` over `owner`, kept inside the work area of owner's
/// monitor. Returns whether it had to be moved, or why moving failed.
fn move_over(
    dialog: windows_sys::Win32::Foundation::HWND,
    owner: windows_sys::Win32::Foundation::HWND,
) -> std::io::Result<bool> {
    if owner.is_null() {
        return Ok(false);
    }
    let mut d = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    let mut o = d;
    let mut monitor = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..unsafe { std::mem::zeroed() } };
    // SAFETY: valid window handles and out-pointers to initialized structs.
    unsafe {
        if GetWindowRect(dialog, &mut d) == 0 || GetWindowRect(owner, &mut o) == 0 {
            return Ok(false);
        }
        if GetMonitorInfoW(MonitorFromWindow(owner, MONITOR_DEFAULTTONEAREST), &mut monitor) == 0 {
            return Ok(false);
        }
    }
    let (w, h) = (d.right - d.left, d.bottom - d.top);
    let area = monitor.rcWork;
    let x = ((o.left + o.right) / 2 - w / 2).clamp(area.left, (area.right - w).max(area.left));
    let y = ((o.top + o.bottom) / 2 - h / 2).clamp(area.top, (area.bottom - h).max(area.top));
    if (d.left, d.top) == (x, y) {
        return Ok(false);
    }
    // SAFETY: dialog is a valid window handle.
    let ok = unsafe { SetWindowPos(dialog, std::ptr::null_mut(), x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE) };
    if ok == 0 {
        return Err(std::io::Error::last_os_error());
    }
    log::debug!("lock: moved the Windows Hello dialog from ({}, {}) to ({x}, {y})", d.left, d.top);
    Ok(true)
}
