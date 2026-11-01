//! App lock. When it is on, the secrets in the keychain (Cloudflare token,
//! Claude API key) are stored encrypted, and the key exists only in memory
//! after Windows Hello verification. Someone who takes over the PC finds
//! only ciphertext; locking forgets the key again.
//!
//! The key is SHA-256 of a Windows Hello signature (see `hello.rs`), so it is
//! never stored. Nothing about the lock is kept in D1: it is per PC.

#[cfg(windows)]
mod hello;

use std::sync::{Mutex, OnceLock};

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, WebviewWindow};

use crate::error::{Error, Result};
use crate::settings;

/// Prefix of an encrypted keychain value: base64 of nonce (12 bytes) + ciphertext.
const SEALED: &str = "zwa-sealed:v1:";
/// Minutes without use before locking, when not set.
const DEFAULT_MINUTES: u32 = 30;

static KEY: Mutex<Option<[u8; 32]>> = Mutex::new(None);

fn key() -> Option<[u8; 32]> {
    *KEY.lock().unwrap()
}

fn set_key(key: Option<[u8; 32]>) {
    *KEY.lock().unwrap() = key;
}

/// Turns a stored keychain value back into the secret.
pub fn open(stored: String) -> Result<String> {
    let Some(sealed) = stored.strip_prefix(SEALED) else {
        return Ok(stored);
    };
    let key = key().ok_or(Error::Locked)?;
    decrypt(&key, sealed).ok_or_else(|| Error::Invalid("保存されている認証情報を復号できません".into()))
}

/// The value to store for `secret`: encrypted while the lock is on.
pub fn seal(secret: &str) -> String {
    match key() {
        Some(key) => encrypt(&key, secret),
        None => secret.to_string(),
    }
}

fn encrypt(key: &[u8; 32], secret: &str) -> String {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let mut bytes = nonce.to_vec();
    bytes.extend(cipher.encrypt(&nonce, secret.as_bytes()).expect("AES-GCM encryption"));
    format!("{SEALED}{}", STANDARD.encode(bytes))
}

fn decrypt(key: &[u8; 32], sealed: &str) -> Option<String> {
    let bytes = STANDARD.decode(sealed).ok()?;
    if bytes.len() < 12 {
        return None;
    }
    let (nonce, ciphertext) = bytes.split_at(12);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let plain = cipher.decrypt(Nonce::from_slice(nonce), ciphertext).ok()?;
    String::from_utf8(plain).ok()
}

fn derive(signature: &[u8]) -> [u8; 32] {
    Sha256::digest(signature).into()
}

/// The keychain entries the lock protects.
fn entries() -> Result<Vec<keyring::Entry>> {
    Ok(vec![crate::credential::entry()?, crate::ai::anthropic::entry()?])
}

fn read(entry: &keyring::Entry) -> Result<Option<String>> {
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Rewrites every protected entry with the current key (or in plain text when
/// there is none). Values are read with `old` first.
fn rewrite(old: Option<[u8; 32]>) -> Result<()> {
    for entry in entries()? {
        let Some(stored) = read(&entry)? else { continue };
        let plain = match stored.strip_prefix(SEALED) {
            Some(sealed) => {
                let key = old.ok_or(Error::Locked)?;
                decrypt(&key, sealed)
                    .ok_or_else(|| Error::Invalid("保存されている認証情報を復号できません".into()))?
            }
            None => stored,
        };
        entry.set_password(&seal(&plain))?;
    }
    Ok(())
}

fn supported() -> bool {
    static SUPPORTED: OnceLock<bool> = OnceLock::new();
    *SUPPORTED.get_or_init(|| {
        #[cfg(windows)]
        return hello::is_supported();
        #[cfg(not(windows))]
        return false;
    })
}

async fn hello_call(
    f: impl FnOnce() -> std::result::Result<Vec<u8>, String> + Send + 'static,
) -> Result<[u8; 32]> {
    let signature = tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| Error::Invalid(e.to_string()))?
        .map_err(Error::Invalid)?;
    Ok(derive(&signature))
}

/// The window the Windows Hello dialog is moved over.
#[cfg(windows)]
fn owner(window: &WebviewWindow) -> isize {
    window.hwnd().map(|h| h.0 as isize).unwrap_or(0)
}
#[cfg(not(windows))]
fn owner(_: &WebviewWindow) -> isize {
    0
}

#[cfg(windows)]
fn hello_create(owner: isize) -> std::result::Result<Vec<u8>, String> {
    hello::create(owner)
}
#[cfg(windows)]
fn hello_unlock(owner: isize) -> std::result::Result<Vec<u8>, String> {
    hello::unlock(owner)
}
#[cfg(not(windows))]
fn hello_create(_: isize) -> std::result::Result<Vec<u8>, String> {
    Err("この OS では Windows Hello を使えません".into())
}
#[cfg(not(windows))]
fn hello_unlock(owner: isize) -> std::result::Result<Vec<u8>, String> {
    hello_create(owner)
}
#[cfg(windows)]
fn hello_delete() {
    if let Err(e) = hello::delete() {
        log::warn!("lock: could not delete the Windows Hello key: {e}");
    }
}
#[cfg(not(windows))]
fn hello_delete() {}

#[derive(Serialize)]
pub struct LockStatus {
    /// Windows Hello is set up on this PC.
    supported: bool,
    enabled: bool,
    locked: bool,
    /// Minutes without use before locking; 0 = only when the app starts.
    minutes: u32,
}

#[tauri::command]
pub fn lock_status(app: AppHandle) -> Result<LockStatus> {
    let settings = settings::load(&app)?;
    Ok(LockStatus {
        supported: supported(),
        enabled: settings.lock_enabled,
        locked: settings.lock_enabled && key().is_none(),
        minutes: settings.lock_minutes.unwrap_or(DEFAULT_MINUTES),
    })
}

#[tauri::command]
pub async fn lock_enable(app: AppHandle, window: WebviewWindow) -> Result<()> {
    let mut settings = settings::load(&app)?;
    if settings.lock_enabled {
        return Ok(());
    }
    let owner = owner(&window);
    let key = hello_call(move || hello_create(owner)).await?;
    set_key(Some(key));
    if let Err(e) = rewrite(None) {
        // Leave everything readable rather than half encrypted.
        set_key(None);
        let _ = rewrite(Some(key));
        hello_delete();
        return Err(e);
    }
    settings.lock_enabled = true;
    settings::save(&app, &settings)?;
    log::info!("lock: turned on");
    Ok(())
}

#[tauri::command]
pub fn lock_disable(app: AppHandle) -> Result<()> {
    let mut settings = settings::load(&app)?;
    if !settings.lock_enabled {
        return Ok(());
    }
    let old = key().ok_or(Error::Locked)?;
    set_key(None);
    if let Err(e) = rewrite(Some(old)) {
        set_key(Some(old));
        return Err(e);
    }
    settings.lock_enabled = false;
    settings::save(&app, &settings)?;
    hello_delete();
    log::info!("lock: turned off");
    Ok(())
}

#[tauri::command]
pub async fn lock_unlock(window: WebviewWindow) -> Result<()> {
    if key().is_some() {
        return Ok(());
    }
    let owner = owner(&window);
    let key = hello_call(move || hello_unlock(owner)).await?;
    // A different key (e.g. Windows Hello was reset) cannot open the secrets.
    for entry in entries()? {
        if let Some(stored) = read(&entry)?
            && let Some(sealed) = stored.strip_prefix(SEALED)
            && decrypt(&key, sealed).is_none()
        {
            return Err(Error::Invalid(
                "Windows Hello の鍵が変わったため、保存されている認証情報を開けません。「登録し直す」から API トークンを登録し直してください".into(),
            ));
        }
    }
    set_key(Some(key));
    log::info!("lock: unlocked");
    Ok(())
}

#[tauri::command]
pub fn lock_now() {
    if key().is_some() {
        set_key(None);
        log::info!("lock: locked");
    }
}

#[tauri::command]
pub fn lock_set_minutes(app: AppHandle, minutes: u32) -> Result<()> {
    let mut settings = settings::load(&app)?;
    settings.lock_minutes = Some(minutes);
    settings::save(&app, &settings)
}

/// When Windows Hello cannot open the secrets any more: deletes them and turns
/// the lock off, so the user can register the token again. Nothing is lost
/// but the token and API key themselves; the sites live in Cloudflare.
#[tauri::command]
pub fn lock_reset(app: AppHandle) -> Result<()> {
    for entry in entries()? {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(e.into()),
        }
    }
    set_key(None);
    let mut settings = settings::load(&app)?;
    settings.lock_enabled = false;
    settings.account_id = None;
    settings::save(&app, &settings)?;
    hello_delete();
    log::info!("lock: reset (secrets deleted)");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sealed_values_round_trip() {
        let key = derive(b"signature");
        let sealed = encrypt(&key, "secret-token");
        assert!(sealed.starts_with(SEALED));
        assert_eq!(decrypt(&key, &sealed[SEALED.len()..]).as_deref(), Some("secret-token"));
        assert_eq!(decrypt(&derive(b"other"), &sealed[SEALED.len()..]), None);
    }
}
