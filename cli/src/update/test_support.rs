use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;

pub struct MockServer {
    pub base: String,
    pub calls: Arc<AtomicUsize>,
    task: tokio::task::JoinHandle<()>,
}

impl MockServer {
    pub async fn new(
        routes: impl FnOnce(&str) -> HashMap<String, Vec<u8>>,
        delay: Duration,
    ) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let routes = routes(&base);
        let calls = Arc::new(AtomicUsize::new(0));
        let count = calls.clone();
        let task = tokio::spawn(async move {
            loop {
                let (socket, _) = listener.accept().await.unwrap();
                let mut socket = BufReader::new(socket);
                let mut request = String::new();
                loop {
                    let mut line = String::new();
                    if socket.read_line(&mut line).await.unwrap_or(0) == 0 {
                        break;
                    }
                    request.push_str(&line);
                    if line == "\r\n" {
                        break;
                    }
                }
                count.fetch_add(1, Ordering::SeqCst);
                let path = request.split_whitespace().nth(1).unwrap_or("");
                let (status, data) = routes
                    .get(path)
                    .map_or((500, b"unavailable".as_slice()), |data| {
                        (200, data.as_slice())
                    });
                tokio::time::sleep(delay).await;
                let headers = format!(
                    "HTTP/1.1 {status} Response\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    data.len()
                );
                let _ = socket.get_mut().write_all(headers.as_bytes()).await;
                let _ = socket.get_mut().write_all(data).await;
            }
        });
        Self { base, calls, task }
    }
}

impl Drop for MockServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub fn release(tag: &str) -> serde_json::Value {
    serde_json::json!({"tag_name": tag, "draft":false,"prerelease":false,"assets":[]})
}
