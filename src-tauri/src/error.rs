use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("サインインしていません")]
    NotSignedIn,
    #[error("アプリがロックされています。Windows Hello で解除してください")]
    Locked,
    #[error("{0}")]
    Invalid(String),
    #[error("Cloudflare API エラー: {0}")]
    Cloudflare(String),
    #[error("通信エラー: {0}")]
    Http(#[from] reqwest::Error),
    #[error("キーチェーンの操作に失敗しました: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("設定ファイルの操作に失敗しました: {0}")]
    Io(#[from] std::io::Error),
    #[error("データの変換に失敗しました: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Tauri(#[from] tauri::Error),
}

impl From<zwa_core::Error> for Error {
    fn from(e: zwa_core::Error) -> Self {
        match e {
            zwa_core::Error::Invalid(m) => Error::Invalid(m),
            zwa_core::Error::Cloudflare(m) => Error::Cloudflare(m),
            zwa_core::Error::Http(e) => Error::Http(e),
            zwa_core::Error::Io(e) => Error::Io(e),
            zwa_core::Error::Json(e) => Error::Json(e),
        }
    }
}

// Commands return errors to the frontend as plain message strings. Every
// command error passes through here, so this is also where they are logged.
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        log::warn!("command failed: {self:?}");
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
