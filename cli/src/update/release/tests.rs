use super::*;
use crate::update::test_support::{MockServer, release, sha256};
use std::collections::HashMap;
use std::sync::atomic::Ordering as AtomicOrdering;

#[test]
fn selects_stable_cli_versions_using_semver() {
    let mut prerelease = release("cli-v9.0.0");
    prerelease["prerelease"] = true.into();
    let mut draft = release("cli-v8.0.0");
    draft["draft"] = true.into();
    let bytes = serde_json::to_vec(&vec![
        release("v99.0.0"),
        release("cli-v2.9.0"),
        release("cli-v2.10.0"),
        release("cli-v3.0.0-rc.1"),
        release("cli-vinvalid"),
        prerelease,
        draft,
    ])
    .unwrap();
    let selected = select_release(&bytes).unwrap();
    assert_eq!(selected.version.to_string(), "2.10.0");
    assert!(selected.newer_than(&Version::parse("2.9.0").unwrap()));
    assert!(!selected.newer_than(&Version::parse("2.10.0+local").unwrap()));
    assert!(!selected.newer_than(&Version::parse("3.0.0").unwrap()));
    assert!(select_release(b"[]").is_err());
    assert!(select_release(b"not json").is_err());
}

#[test]
fn maps_only_published_platforms() {
    for (os, arch, name) in [
        ("linux", "x86_64", "fontinass-linux-x64"),
        ("windows", "x86_64", "fontinass-windows-x64.exe"),
        ("macos", "x86_64", "fontinass-macos-x64"),
        ("macos", "aarch64", "fontinass-macos-arm64"),
    ] {
        assert_eq!(platform_asset(os, arch).unwrap(), name);
    }
    assert!(platform_asset("linux", "aarch64").is_err());
}

#[test]
fn rejects_missing_ambiguous_or_invalid_checksums() {
    let hash = "a".repeat(64);
    assert_eq!(
        checksum_for(&format!("{hash} *binary\r\n"), "binary").unwrap(),
        hash
    );
    assert!(checksum_for(&format!("{hash} binary\n{hash} binary\n"), "binary").is_err());
    assert!(checksum_for("wrong binary\n", "binary").is_err());
    assert!(checksum_for(&format!("{hash} other\n"), "binary").is_err());
}

async fn download_server(corrupt: bool, wrong_url: bool) -> MockServer {
    MockServer::new(|base| {
        let bytes = b"fixture release binary".to_vec();
        let expected = if corrupt { "0".repeat(64) } else { sha256(&bytes) };
        let mut item = release("cli-v9.8.7");
        item["assets"] = serde_json::json!([
            {"name":"fontinass-linux-x64","size":bytes.len(),"browser_download_url":if wrong_url { "https://example.org/foreign.exe".to_owned() } else {format!("{base}/download/cli-v9.8.7/fontinass-linux-x64")},"digest":format!("sha256:{expected}")},
            {"name":"SHA256SUMS","size":100,"browser_download_url":format!("{base}/download/cli-v9.8.7/SHA256SUMS")}
        ]);
        HashMap::from([
            ("/releases".into(),serde_json::to_vec(&vec![item]).unwrap()),
            ("/download/cli-v9.8.7/SHA256SUMS".into(),format!("{expected}  fontinass-linux-x64\n").into_bytes()),
            ("/download/cli-v9.8.7/fontinass-linux-x64".into(),bytes),
        ])
    },Duration::ZERO).await
}

#[tokio::test]
async fn downloads_and_verifies_the_selected_release() {
    let server = download_server(false, false).await;
    let github = Github::test_server(&server.base);
    let latest = github.latest().await.unwrap();
    let file = github
        .download(&latest, "fontinass-linux-x64")
        .await
        .unwrap();
    assert_eq!(std::fs::read(&file).unwrap(), b"fixture release binary");
    assert_eq!(server.calls.load(AtomicOrdering::SeqCst), 3);
}

#[tokio::test]
async fn rejects_corruption_and_foreign_download_urls() {
    for (corrupt, wrong_url, message) in [
        (true, false, "SHA-256 verification failed"),
        (false, true, "Unexpected download URL"),
    ] {
        let server = download_server(corrupt, wrong_url).await;
        let github = Github::test_server(&server.base);
        let latest = github.latest().await.unwrap();
        let error = github
            .download(&latest, "fontinass-linux-x64")
            .await
            .unwrap_err();
        assert!(error.to_string().contains(message), "{error:#}");
    }
}

#[tokio::test]
async fn rejects_unexpected_download_size() {
    let server = MockServer::new(
        |_| HashMap::from([("/binary".into(), b"too long".to_vec())]),
        Duration::ZERO,
    )
    .await;
    let response = reqwest::get(format!("{}/binary", server.base))
        .await
        .unwrap();
    let mut file = NamedTempFile::new().unwrap();
    assert!(
        download_checked(response, &mut file, 1, &"0".repeat(64))
            .await
            .is_err()
    );
    assert!(std::fs::read(file.path()).unwrap().is_empty());
}
