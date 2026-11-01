//! Minimal Cloudflare API client.

use reqwest::Method;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::error::{Error, Result};

const API_BASE: &str = "https://api.cloudflare.com/client/v4";

#[derive(Deserialize)]
struct Envelope<T> {
    success: bool,
    /// Some endpoints (e.g. the assets upload session) send `null` on success.
    #[serde(default, deserialize_with = "null_as_empty")]
    errors: Vec<ApiMessage>,
    result: Option<T>,
}

/// For lists the API sends as `null` instead of `[]` or leaving them out.
pub(crate) fn null_as_empty<'de, D, T>(d: D) -> std::result::Result<Vec<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Option::deserialize(d)?.unwrap_or_default())
}

#[derive(Deserialize)]
struct ApiMessage {
    code: i64,
    message: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct D1Database {
    pub uuid: String,
    pub name: String,
}

#[derive(Deserialize)]
pub struct R2Bucket {
    pub name: String,
}

#[derive(Deserialize)]
struct R2BucketList {
    buckets: Vec<R2Bucket>,
}

#[derive(Deserialize)]
pub struct QueryResult {
    #[serde(default)]
    pub results: Vec<Value>,
    #[serde(default)]
    pub meta: QueryMeta,
}

#[derive(Default, Deserialize)]
pub struct QueryMeta {
    #[serde(default)]
    pub changes: u64,
}

/// Authenticated with a bearer token (an API token, or later an OAuth
/// access token).
pub struct Client {
    http: reqwest::Client,
    token: String,
}

impl Client {
    pub fn new(token: impl Into<String>) -> Self {
        // Without these, a request Cloudflare never answers waits forever.
        // A read timeout (not a total one) so large uploads can still finish.
        let http = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(30))
            .read_timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("HTTP client");
        Self {
            http,
            token: token.into(),
        }
    }

    async fn request<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<T> {
        let mut req = self
            .http
            .request(method, format!("{API_BASE}{path}"))
            .bearer_auth(&self.token);
        if let Some(body) = body {
            req = req.json(&body);
        }
        let res = req.send().await?;
        let status = res.status();
        let text = res.text().await?;
        // The serde message says what didn't fit (e.g. "invalid type: null
        // ... at line 1 column 80") without echoing values such as tokens.
        let body: Envelope<T> = serde_json::from_str(&text)
            .map_err(|e| Error::Cloudflare(format!("HTTP {status}（応答を読めませんでした: {e}）")))?;
        if !body.success {
            let detail = body
                .errors
                .iter()
                .map(|e| format!("{} ({})", e.message, e.code))
                .collect::<Vec<_>>()
                .join(", ");
            return Err(Error::Cloudflare(if detail.is_empty() {
                format!("HTTP {status}")
            } else {
                detail
            }));
        }
        body.result
            .ok_or_else(|| Error::Cloudflare("result がありません".into()))
    }

    async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        self.request(Method::GET, path, None).await
    }

    async fn post<T: DeserializeOwned>(&self, path: &str, body: Value) -> Result<T> {
        self.request(Method::POST, path, Some(body)).await
    }

    /// Lists the accounts the credential can access. Also serves as the
    /// validity check: it works for both user tokens and account tokens,
    /// unlike `/user/tokens/verify`.
    pub async fn accounts(&self) -> Result<Vec<Account>> {
        self.get("/accounts?per_page=50").await
    }

    pub async fn d1_list(&self, account_id: &str) -> Result<Vec<D1Database>> {
        self.get(&format!("/accounts/{account_id}/d1/database?per_page=1000"))
            .await
    }

    pub async fn d1_create(&self, account_id: &str, name: &str) -> Result<D1Database> {
        self.post(
            &format!("/accounts/{account_id}/d1/database"),
            json!({ "name": name }),
        )
        .await
    }

    /// Runs one or more `;`-separated statements. `params` binds `?` / `?N`
    /// placeholders and is only allowed with a single statement.
    pub async fn d1_query(
        &self,
        account_id: &str,
        database_id: &str,
        sql: &str,
        params: &[Value],
    ) -> Result<Vec<QueryResult>> {
        let mut body = json!({ "sql": sql });
        if !params.is_empty() {
            body["params"] = json!(params);
        }
        self.post(
            &format!("/accounts/{account_id}/d1/database/{database_id}/query"),
            body,
        )
        .await
    }

    pub async fn r2_list(&self, account_id: &str) -> Result<Vec<R2Bucket>> {
        let list: R2BucketList = self
            .get(&format!("/accounts/{account_id}/r2/buckets?per_page=1000"))
            .await?;
        Ok(list.buckets)
    }

    /// Object endpoints are the ones `wrangler r2 object` uses with an API
    /// token. They are not part of the documented v4 API reference.
    fn r2_object_path(account_id: &str, bucket: &str, key: &str) -> String {
        let key = key
            .split('/')
            .map(|seg| {
                percent_encoding::utf8_percent_encode(seg, percent_encoding::NON_ALPHANUMERIC)
                    .to_string()
            })
            .collect::<Vec<_>>()
            .join("/");
        format!("{API_BASE}/accounts/{account_id}/r2/buckets/{bucket}/objects/{key}")
    }

    pub async fn r2_put(
        &self,
        account_id: &str,
        bucket: &str,
        key: &str,
        content_type: &str,
        bytes: Vec<u8>,
    ) -> Result<()> {
        let res = self
            .http
            .put(Self::r2_object_path(account_id, bucket, key))
            .bearer_auth(&self.token)
            .header(reqwest::header::CONTENT_TYPE, content_type)
            .body(bytes)
            .send()
            .await?;
        Self::check_raw(res).await.map(|_| ())
    }

    pub async fn r2_get(&self, account_id: &str, bucket: &str, key: &str) -> Result<Vec<u8>> {
        let res = self
            .http
            .get(Self::r2_object_path(account_id, bucket, key))
            .bearer_auth(&self.token)
            .send()
            .await?;
        Ok(Self::check_raw(res).await?.bytes().await?.to_vec())
    }

    pub async fn r2_delete(&self, account_id: &str, bucket: &str, key: &str) -> Result<()> {
        let res = self
            .http
            .delete(Self::r2_object_path(account_id, bucket, key))
            .bearer_auth(&self.token)
            .send()
            .await?;
        match Self::check_raw(res).await {
            Err(Error::Cloudflare(msg)) if msg.contains("HTTP 404") => Ok(()),
            r => r.map(|_| ()),
        }
    }

    /// For endpoints that do not always return the JSON envelope.
    async fn check_raw(res: reqwest::Response) -> Result<reqwest::Response> {
        let status = res.status();
        if status.is_success() {
            return Ok(res);
        }
        let text = res.text().await.unwrap_or_default();
        let detail = serde_json::from_str::<Envelope<Value>>(&text)
            .ok()
            .map(|e| {
                e.errors
                    .iter()
                    .map(|e| format!("{} ({})", e.message, e.code))
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .filter(|d| !d.is_empty())
            .unwrap_or(text);
        Err(Error::Cloudflare(format!("HTTP {status}: {detail}")))
    }

    /// Sends a multipart request and unwraps the JSON envelope. `bearer`
    /// overrides the credential (asset uploads use a session JWT).
    pub async fn multipart<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        form: reqwest::multipart::Form,
        bearer: Option<&str>,
    ) -> Result<T> {
        let res = self
            .http
            .request(method, format!("{API_BASE}{path}"))
            .bearer_auth(bearer.unwrap_or(&self.token))
            .multipart(form)
            .send()
            .await?;
        let status = res.status();
        let text = res.text().await?;
        let body: Envelope<T> = serde_json::from_str(&text)
            .map_err(|_| Error::Cloudflare(format!("HTTP {status}: {text}")))?;
        if !body.success {
            let detail = body
                .errors
                .iter()
                .map(|e| format!("{} ({})", e.message, e.code))
                .collect::<Vec<_>>()
                .join(", ");
            return Err(Error::Cloudflare(format!("HTTP {status}: {detail}")));
        }
        body.result
            .ok_or_else(|| Error::Cloudflare("result がありません".into()))
    }

    pub async fn post_json<T: DeserializeOwned>(&self, path: &str, body: Value) -> Result<T> {
        self.post(path, body).await
    }

    pub async fn get_json<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        self.get(path).await
    }

    pub async fn put_json<T: DeserializeOwned>(&self, path: &str, body: Value) -> Result<T> {
        self.request(Method::PUT, path, Some(body)).await
    }

    pub async fn delete_json<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        self.request(Method::DELETE, path, None).await
    }

    pub async fn r2_create(&self, account_id: &str, name: &str) -> Result<R2Bucket> {
        self.post(
            &format!("/accounts/{account_id}/r2/buckets"),
            json!({ "name": name }),
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_with_null_errors() {
        let e: Envelope<Value> =
            serde_json::from_str(r#"{"success":true,"errors":null,"messages":null,"result":{}}"#).unwrap();
        assert!(e.success && e.errors.is_empty());
    }
}
