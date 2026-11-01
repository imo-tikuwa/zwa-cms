#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Invalid(String),
    #[error("Cloudflare API エラー: {0}")]
    Cloudflare(String),
    #[error("通信エラー: {0}")]
    Http(#[from] reqwest::Error),
    #[error("ファイルの操作に失敗しました: {0}")]
    Io(#[from] std::io::Error),
    #[error("データの変換に失敗しました: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, Error>;
