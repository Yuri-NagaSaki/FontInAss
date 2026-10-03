use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::process::Command;
use tokio::time::timeout;

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("fontinass-cli-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

async fn check_subset_request(file_count: usize, mode: Option<&str>) {
    let directory = TestDirectory::new();
    let files: Vec<_> = (0..file_count)
        .map(|i| directory.0.join(format!("{i}.ass")))
        .collect();
    for file in &files {
        std::fs::write(file, "original").unwrap();
    }
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        timeout(Duration::from_secs(10), async move {
            let (socket, _) = listener.accept().await.unwrap();
            let mut reader = BufReader::new(socket);
            let mut headers = String::new();
            loop {
                let mut line = String::new();
                assert!(reader.read_line(&mut line).await.unwrap() > 0);
                headers.push_str(&line);
                if line == "\r\n" {
                    break;
                }
            }
            let content_length: usize = headers.lines().find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length").then(|| value.trim().parse().unwrap())
            }).expect("request content length");
            let mut body = vec![0; content_length];
            reader.read_exact(&mut body).await.unwrap();

            let response_body = if file_count == 1 {
                "processed".to_owned()
            } else {
                serde_json::json!({ "results": (0..file_count).map(|i| serde_json::json!({
                    "filename": format!("{i}.ass"), "code": 200, "data": "cHJvY2Vzc2Vk"
                })).collect::<Vec<_>>() }).to_string()
            };
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nX-Code: 200\r\nConnection: close\r\n\r\n{}",
                response_body.len(), response_body
            );
            reader.get_mut().write_all(response.as_bytes()).await.unwrap();
            headers
        }).await.expect("mock server timed out")
    });

    let mut command = Command::new(env!("CARGO_BIN_EXE_fontinass"));
    command.args([
        "subset",
        "--server",
        &format!("http://{address}"),
        "--api-key",
        "",
        "--strict",
        "--clean",
    ]);
    command.arg("--output").arg(directory.0.join("output"));
    if let Some(mode) = mode {
        command.args(["--font-name-mode", mode]);
    }
    command.args(&files);
    let output = timeout(Duration::from_secs(10), command.kill_on_drop(true).output())
        .await
        .expect("CLI timed out")
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let headers = server.await.unwrap().to_lowercase();
    assert!(headers.starts_with("post /api/subset http/1.1\r\n"));
    assert!(headers.contains(&format!(
        "\r\nx-font-name-mode: {}\r\n",
        mode.unwrap_or("alias")
    )));
    assert!(headers.contains("\r\nx-fonts-check: 1\r\n"));
    assert!(headers.contains("\r\nx-clear-fonts: 1\r\n"));
    assert!(headers.contains(if file_count == 1 {
        "application/octet-stream"
    } else {
        "multipart/form-data"
    }));
    for file in &files {
        assert_eq!(
            std::fs::read_to_string(directory.0.join("output").join(file.file_name().unwrap()))
                .unwrap(),
            "processed"
        );
        assert_eq!(std::fs::read_to_string(file).unwrap(), "original");
    }
}

#[tokio::test]
async fn transmits_font_name_mode_for_single_and_batch_requests() {
    for file_count in [1, 2] {
        for mode in [None, Some("alias"), Some("preserve")] {
            check_subset_request(file_count, mode).await;
        }
    }
}

#[test]
fn rejects_unknown_font_name_modes() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_fontinass"))
        .args(["subset", "--font-name-mode", "unknown"])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("invalid value"));
}
