//! Sign-in commands. The token never leaves the Rust side.

use serde::Serialize;
use tauri::AppHandle;

use crate::cloudflare::{Account, Client};
use crate::credential::{self, Credential};
use crate::error::{Error, Result};
use crate::settings;

#[derive(Serialize)]
pub struct AuthStatus {
    /// "api_token" (and later "oauth"), or None when signed out.
    method: Option<&'static str>,
    accounts: Vec<Account>,
    account_id: Option<String>,
}

async fn status_for(app: &AppHandle, credential: Credential) -> Result<AuthStatus> {
    let accounts = Client::new(credential.bearer()).accounts().await?;
    let mut settings = settings::load(app)?;
    // Keep the saved account only if it is still accessible; pick the only
    // account automatically.
    if !accounts
        .iter()
        .any(|a| Some(&a.id) == settings.account_id.as_ref())
    {
        settings.account_id = (accounts.len() == 1).then(|| accounts[0].id.clone());
        settings::save(app, &settings)?;
    }
    Ok(AuthStatus {
        method: Some(credential.kind()),
        accounts,
        account_id: settings.account_id,
    })
}

#[tauri::command]
pub async fn auth_status(app: AppHandle) -> Result<AuthStatus> {
    match credential::load()? {
        Some(credential) => status_for(&app, credential).await,
        None => Ok(AuthStatus {
            method: None,
            accounts: vec![],
            account_id: None,
        }),
    }
}

#[tauri::command]
pub async fn auth_sign_in_with_token(app: AppHandle, token: String) -> Result<AuthStatus> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err(Error::Invalid("API トークンを入力してください".into()));
    }
    let credential = Credential::ApiToken { token };
    // Verify before saving so a bad token is never stored.
    let status = status_for(&app, credential.clone()).await?;
    if status.accounts.is_empty() {
        return Err(Error::Cloudflare(
            "このトークンでアクセスできるアカウントがありません".into(),
        ));
    }
    credential::save(&credential)?;
    Ok(status)
}

#[tauri::command]
pub fn auth_select_account(app: AppHandle, account_id: String) -> Result<()> {
    let mut settings = settings::load(&app)?;
    settings.account_id = Some(account_id);
    settings::save(&app, &settings)
}

#[tauri::command]
pub fn auth_sign_out(app: AppHandle) -> Result<()> {
    credential::delete()?;
    let mut settings = settings::load(&app)?;
    settings.account_id = None;
    settings::save(&app, &settings)
}

pub fn current_credential() -> Result<Credential> {
    credential::load()?.ok_or(Error::NotSignedIn)
}
