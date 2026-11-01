//! Claude API client (raw HTTP; there is no official Rust SDK).
//!
//! Requests are streamed so long generations (whole articles) neither hit
//! HTTP timeouts nor leave the UI without progress. The API key lives in
//! the OS keychain and never reaches the webview.

use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::error::{Error, Result};

const API_BASE: &str = "https://api.anthropic.com/v1";
const API_VERSION: &str = "2026-10-21";
/// Server-side refusal fallback ("default" picks the recommended model per
/// refusal category).
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";

const KEYRING_SERVICE: &str = "zwa-cms";
const KEYRING_ENTRY: &str = "anthropic";

pub const DEFAULT_MODEL: &str = "claude-opus-5-5";

/// Models offered in the settings. Only these are accepted.
pub const MODELS: &[&str] = &[
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-haiku-5-5",
    "claude-fable-5-1",
];

/// Models that accept `fallbacks: "default"`.
fn supports_fallback(model: &str) -> bool {
    matches!(
        model,
        "claude-opus-5-5" | "claude-sonnet-5-5" | "claude-fable-5-1"
    )
}

pub(crate) fn entry() -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(KEYRING_SERVICE, KEYRING_ENTRY)?)
}

pub fn load_key() -> Result<Option<String>> {
    match entry()?.get_password() {
        Ok(stored) => Ok(Some(crate::lock::open(stored)?)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn save_key(key: &str) -> Result<()> {
    entry()?.set_password(&crate::lock::seal(key))?;
    Ok(())
}

pub fn delete_key() -> Result<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[derive(Deserialize)]
struct ApiError {
    error: ApiErrorBody,
}

#[derive(Deserialize)]
struct ApiErrorBody {
    #[serde(rename = "type")]
    kind: String,
    message: String,
}

fn api_error(status: reqwest::StatusCode, body: &str) -> Error {
    let detail = serde_json::from_str::<ApiError>(body)
        .map(|e| format!("{} ({})", e.error.message, e.error.kind))
        .unwrap_or_else(|_| body.chars().take(300).collect());
    let hint = match status.as_u16() {
        401 => "\nAPI キーが正しくありません。",
        402 | 403 if detail.contains("credit") => {
            "\nクレジットの残高が不足しています。Claude Console の Billing で確認してください。"
        }
        429 => "\n利用上限に達しました。しばらく待ってから再度お試しください。",
        529 => "\nAPI が混み合っています。しばらく待ってから再度お試しください。",
        _ => "",
    };
    Error::Invalid(format!(
        "Claude API エラー（HTTP {status}）: {detail}{hint}"
    ))
}

/// Checks a key without spending tokens (lists models).
pub async fn verify_key(key: &str) -> Result<()> {
    let res = reqwest::Client::new()
        .get(format!("{API_BASE}/models?limit=1"))
        .header("x-api-key", key)
        .header("anthropic-version", API_VERSION)
        .send()
        .await?;
    let status = res.status();
    if status.is_success() {
        Ok(())
    } else {
        Err(api_error(status, &res.text().await.unwrap_or_default()))
    }
}

pub struct Request<'a> {
    pub model: &'a str,
    pub system: &'a str,
    pub user: String,
    pub effort: &'a str,
    pub max_tokens: u32,
    /// JSON schema for structured output, or None for free text.
    pub schema: Option<Value>,
}

/// Token counts of one request, as reported by the API.
#[derive(Default)]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
}

impl Usage {
    /// `message_start` and `message_delta` both carry usage; the counts in
    /// `message_delta` are cumulative, so present fields replace earlier ones.
    fn update(&mut self, usage: &Value) {
        let set = |field: &mut u64, key: &str| {
            if let Some(n) = usage[key].as_u64() {
                *field = n;
            }
        };
        set(&mut self.input_tokens, "input_tokens");
        set(&mut self.output_tokens, "output_tokens");
        set(&mut self.cache_read_tokens, "cache_read_input_tokens");
        set(&mut self.cache_write_tokens, "cache_creation_input_tokens");
    }
}

pub struct Output {
    text: String,
    stop_reason: Option<String>,
    /// The model that answered (a fallback model after a refusal).
    pub model: String,
    pub usage: Usage,
}

impl Output {
    /// The full text (JSON when a schema was given), or an error for a
    /// refusal or truncated output.
    pub fn into_text(self) -> Result<String> {
        match self.stop_reason.as_deref() {
            Some("refusal") => Err(Error::Invalid(
                "Claude がこの依頼を処理できませんでした（安全性の判定）。内容を変えて再度お試しください。".into(),
            )),
            Some("max_tokens") => Err(Error::Invalid("出力が長すぎて途中で終わりました。".into())),
            _ => Ok(self.text),
        }
    }
}

/// Runs a request, calling `on_text` with each text delta. The output is
/// returned even when it ended in a refusal, so its usage can be recorded.
pub async fn stream(key: &str, req: Request<'_>, mut on_text: impl FnMut(&str)) -> Result<Output> {
    let mut output_config = json!({ "effort": req.effort });
    if let Some(schema) = req.schema {
        output_config["format"] = json!({ "type": "json_schema", "schema": schema });
    }
    let mut body = json!({
        "model": req.model,
        "max_tokens": req.max_tokens,
        "stream": true,
        "system": req.system,
        "output_config": output_config,
        "messages": [{ "role": "user", "content": req.user }],
    });
    let mut http = reqwest::Client::new()
        .post(format!("{API_BASE}/messages"))
        .header("x-api-key", key)
        .header("anthropic-version", API_VERSION)
        .header("content-type", "application/json");
    if supports_fallback(req.model) {
        body["fallbacks"] = json!("default");
        http = http.header("anthropic-beta", FALLBACK_BETA);
    }
    let res = http.json(&body).send().await?;
    let status = res.status();
    if !status.is_success() {
        return Err(api_error(status, &res.text().await.unwrap_or_default()));
    }

    // Server-sent events: "event: x\ndata: {...}\n\n". Only `data` lines matter.
    let mut text = String::new();
    let mut stop_reason: Option<String> = None;
    let mut model = req.model.to_string();
    let mut usage = Usage::default();
    let mut buf = String::new();
    let mut bytes = res.bytes_stream();
    while let Some(chunk) = bytes.next().await {
        buf.push_str(&String::from_utf8_lossy(&chunk?));
        while let Some(pos) = buf.find('\n') {
            let line: String = buf.drain(..=pos).collect();
            let Some(data) = line.trim_end().strip_prefix("data: ") else {
                continue;
            };
            let Ok(event) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            match event["type"].as_str() {
                Some("message_start") => {
                    if let Some(m) = event["message"]["model"].as_str() {
                        model = m.to_string();
                    }
                    usage.update(&event["message"]["usage"]);
                }
                Some("content_block_delta") if event["delta"]["type"] == "text_delta" => {
                    if let Some(t) = event["delta"]["text"].as_str() {
                        text.push_str(t);
                        on_text(t);
                    }
                }
                // A fallback model may take over mid-stream; its output
                // replaces what came before.
                Some("content_block_start") if event["content_block"]["type"] == "fallback" => {
                    text.clear();
                }
                Some("message_delta") => {
                    if let Some(r) = event["delta"]["stop_reason"].as_str() {
                        stop_reason = Some(r.to_string());
                    }
                    usage.update(&event["usage"]);
                }
                Some("error") => {
                    let msg = event["error"]["message"].as_str().unwrap_or("不明なエラー");
                    return Err(Error::Invalid(format!("Claude API エラー: {msg}")));
                }
                _ => {}
            }
        }
    }
    Ok(Output {
        text,
        stop_reason,
        model,
        usage,
    })
}
