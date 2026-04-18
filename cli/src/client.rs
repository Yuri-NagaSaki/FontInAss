use std::path::Path;

use anyhow::{bail, Context, Result};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use reqwest::Client;
use serde::Deserialize;

/// Result of processing a single subtitle file.
pub struct SubsetResult {
    pub filename: String,
    pub code: u16,
    pub messages: Vec<String>,
    pub data: Option<Vec<u8>>,
}

/// Options controlling how subset is performed.
pub struct SubsetOpts {
    pub strict: bool,
    pub clean: bool,
    pub api_key: String,
}

#[derive(Deserialize)]
struct BatchResponse {
    results: Vec<BatchItem>,
}

#[derive(Deserialize)]
struct BatchItem {
    filename: String,
    code: u16,
    messages: Option<Vec<String>>,
    /// Base64-encoded file data returned by the server for batch requests.
    data: Option<String>,
}

/// Decode the X-Message header: base64 → bytes → UTF-8 → JSON string array.
fn decode_messages(header_val: &str) -> Vec<String> {
    if header_val.is_empty() {
        return vec![];
    }
    let bytes = match B64.decode(header_val) {
        Ok(b) => b,
        Err(_) => return vec![header_val.to_string()],
    };
    let text = match String::from_utf8(bytes) {
        Ok(t) => t,
        Err(_) => return vec![header_val.to_string()],
    };
    match serde_json::from_str::<Vec<String>>(&text) {
        Ok(v) => v,
        Err(_) => vec![text],
    }
}

/// Base64-encode a string for use in request headers.
fn b64_encode(s: &str) -> String {
    B64.encode(s.as_bytes())
}

/// Process a single file via raw binary body.
pub async fn subset_single(
    client: &Client,
    server: &str,
    file_path: &Path,
    opts: &SubsetOpts,
) -> Result<SubsetResult> {
    let filename = file_path
        .file_name()
        .context("No filename")?
        .to_string_lossy()
        .to_string();

    let body = std::fs::read(file_path)
        .with_context(|| format!("Failed to read {}", file_path.display()))?;

    let mut req = client
        .post(format!("{}/api/subset", server.trim_end_matches('/')))
        .header("Content-Type", "application/octet-stream")
        .header("X-Filename", b64_encode(&filename))
        .header("X-Fonts-Check", if opts.strict { "1" } else { "0" })
        .header("X-Clear-Fonts", if opts.clean { "1" } else { "0" });

    if !opts.api_key.is_empty() {
        req = req.header("X-API-Key", &opts.api_key);
    }

    let resp = req.body(body).send().await
        .with_context(|| format!("Request failed for {}", filename))?;

    let code: u16 = resp
        .headers()
        .get("x-code")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(500);

    let messages = resp
        .headers()
        .get("x-message")
        .and_then(|v| v.to_str().ok())
        .map(decode_messages)
        .unwrap_or_default();

    let data = resp.bytes().await
        .context("Failed to read response body")?
        .to_vec();

    let data = if data.is_empty() { None } else { Some(data) };

    Ok(SubsetResult {
        filename,
        code,
        messages,
        data,
    })
}

/// Process multiple files via multipart form.
pub async fn subset_batch(
    client: &Client,
    server: &str,
    file_paths: &[&Path],
    opts: &SubsetOpts,
) -> Result<Vec<SubsetResult>> {
    if file_paths.is_empty() {
        bail!("No files to process");
    }

    let mut form = reqwest::multipart::Form::new();
    for path in file_paths {
        let filename = path
            .file_name()
            .context("No filename")?
            .to_string_lossy()
            .to_string();
        let body = std::fs::read(path)
            .with_context(|| format!("Failed to read {}", path.display()))?;
        let part = reqwest::multipart::Part::bytes(body)
            .file_name(filename)
            .mime_str("application/octet-stream")?;
        form = form.part("file", part);
    }

    let mut req = client
        .post(format!("{}/api/subset", server.trim_end_matches('/')))
        .header("X-Fonts-Check", if opts.strict { "1" } else { "0" })
        .header("X-Clear-Fonts", if opts.clean { "1" } else { "0" })
        .multipart(form);

    if !opts.api_key.is_empty() {
        req = req.header("X-API-Key", &opts.api_key);
    }

    let resp = req.send().await.context("Batch request failed")?;

    if !resp.status().is_success() && resp.status().as_u16() != 207 {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        bail!("Server error {}: {}", status, text);
    }

    let batch: BatchResponse = resp.json().await
        .context("Failed to parse batch response")?;

    Ok(batch
        .results
        .into_iter()
        .map(|item| SubsetResult {
            filename: item.filename,
            code: item.code,
            messages: item.messages.unwrap_or_default(),
            data: item.data.and_then(|s| B64.decode(s).ok()),
        })
        .collect())
}
