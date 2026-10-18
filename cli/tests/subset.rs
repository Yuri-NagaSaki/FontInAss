use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
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

async fn check_subset_request(codes: &[u16], mode: Option<&str>, strict: bool) {
    let file_count = codes.len();
    let directory = TestDirectory::new();
    let files: Vec<_> = (0..file_count)
        .map(|i| directory.0.join(format!("{i}.ass")))
        .collect();
    for file in &files {
        std::fs::write(file, "original").unwrap();
    }
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let response_codes = codes.to_vec();
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

            let messages = |code| match code {
                201 => vec!["Missing glyphs in [Fixture]: —€"],
                300 => vec!["Missing font: [Unknown]"],
                500 => vec!["Internal server error"],
                _ => vec![],
            };
            let response_body = if file_count == 1 {
                if response_codes[0] <= 201 { "processed" } else { "" }.to_owned()
            } else {
                serde_json::json!({ "results": (0..file_count).map(|i| serde_json::json!({
                    "filename": format!("{i}.ass"), "code": response_codes[i],
                    "messages": messages(response_codes[i]),
                    "data": if response_codes[i] <= 201 { Some("cHJvY2Vzc2Vk") } else { None }
                })).collect::<Vec<_>>() }).to_string()
            };
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nX-Code: {}\r\nX-Message: {}\r\nConnection: close\r\n\r\n{}",
                response_body.len(), response_codes[0],
                B64.encode(serde_json::to_vec(&messages(response_codes[0])).unwrap()), response_body
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
        "--clean",
    ]);
    if strict {
        command.arg("--strict");
    }
    command.arg("--output").arg(directory.0.join("output"));
    if let Some(mode) = mode {
        command.args(["--font-name-mode", mode]);
    }
    command.args(&files);
    let output = timeout(Duration::from_secs(10), command.kill_on_drop(true).output())
        .await
        .expect("CLI timed out")
        .unwrap();
    assert_eq!(
        output.status.success(),
        codes.iter().all(|code| *code <= 201),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let headers = server.await.unwrap().to_lowercase();
    assert!(headers.starts_with("post /api/subset http/1.1\r\n"));
    assert!(headers.contains(&format!(
        "\r\nx-font-name-mode: {}\r\n",
        mode.unwrap_or("alias")
    )));
    assert!(headers.contains(&format!("\r\nx-fonts-check: {}\r\n", u8::from(strict))));
    assert!(headers.contains("\r\nx-clear-fonts: 1\r\n"));
    assert!(headers.contains(if file_count == 1 {
        "application/octet-stream"
    } else {
        "multipart/form-data"
    }));
    for (file, code) in files.iter().zip(codes) {
        let target = directory.0.join("output").join(file.file_name().unwrap());
        if *code <= 201 {
            assert_eq!(std::fs::read_to_string(target).unwrap(), "processed");
        } else {
            assert!(!target.exists());
        }
        assert_eq!(std::fs::read_to_string(file).unwrap(), "original");
    }
    if codes.contains(&201) {
        assert!(String::from_utf8_lossy(&output.stdout).contains("—€"));
    }
}

#[tokio::test]
async fn transmits_font_name_mode_for_single_and_batch_requests() {
    for file_count in [1, 2] {
        for mode in [None, Some("alias"), Some("preserve")] {
            check_subset_request(&vec![200; file_count], mode, true).await;
        }
    }
}

#[tokio::test]
async fn strict_mode_saves_glyph_warnings_but_rejects_font_errors() {
    for codes in [
        vec![201],
        vec![201, 201],
        vec![300],
        vec![201, 300],
        vec![300, 201],
        vec![500],
    ] {
        check_subset_request(&codes, None, true).await;
    }
}

#[tokio::test]
async fn normal_mode_still_saves_warning_results() {
    for codes in [vec![201], vec![200, 201]] {
        check_subset_request(&codes, None, false).await;
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

#[test]
fn rejects_output_collisions_before_contacting_server() {
    let directory = TestDirectory::new();
    let first = directory.0.join("first");
    let second = directory.0.join("second");
    std::fs::create_dir_all(&first).unwrap();
    std::fs::create_dir_all(&second).unwrap();
    std::fs::write(first.join("same.ass"), "first").unwrap();
    std::fs::write(second.join("same.ass"), "second").unwrap();
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_fontinass"))
        .args(["subset", "--server", "http://127.0.0.1:1", "--output"])
        .arg(directory.0.join("output"))
        .arg(first.join("same.ass"))
        .arg(second.join("same.ass"))
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("Output path collision"));
    assert_eq!(
        std::fs::read_to_string(first.join("same.ass")).unwrap(),
        "first"
    );
}

#[tokio::test]
async fn processes_a_single_file_remainder_as_binary() {
    let directory = TestDirectory::new();
    let files: Vec<_> = (0..11)
        .map(|i| directory.0.join(format!("{i:02}.ass")))
        .collect();
    for file in &files {
        std::fs::write(file, "original").unwrap();
    }
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        for count in [10, 1] {
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
            let size: usize = headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse().unwrap())
                })
                .unwrap();
            reader.read_exact(&mut vec![0; size]).await.unwrap();
            let body = if count == 1 {
                assert!(headers.to_lowercase().contains("application/octet-stream"));
                "processed".to_string()
            } else {
                serde_json::json!({"results": (0..10).map(|i| serde_json::json!({"filename":format!("{i:02}.ass"),"code":200,"data":"cHJvY2Vzc2Vk"})).collect::<Vec<_>>()}).to_string()
            };
            reader.get_mut().write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nX-Code: 200\r\nConnection: close\r\n\r\n{}",body.len(),body).as_bytes()).await.unwrap();
        }
    });
    let output = timeout(
        Duration::from_secs(10),
        Command::new(env!("CARGO_BIN_EXE_fontinass"))
            .args([
                "subset",
                "--server",
                &format!("http://{address}"),
                "--api-key",
                "",
            ])
            .args(&files)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    server.await.unwrap();
    for file in files {
        assert_eq!(std::fs::read_to_string(file).unwrap(), "processed");
    }
}
