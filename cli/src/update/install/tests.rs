use super::*;
use crate::update::release::{Github, platform_asset};
use crate::update::test_support::{MockServer, release, sha256};
use std::collections::HashMap;

#[test]
fn serializes_updates_to_the_same_installation() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("fontinass.exe");
    std::fs::write(&path, b"original").unwrap();
    let first = Installation::lock(path.clone()).unwrap();
    assert!(Installation::lock(path.clone()).is_err());
    drop(first);
    assert!(Installation::lock(path).is_ok());
}

#[tokio::test]
async fn refuses_non_executable_download_without_modifying_installation() {
    let dir = tempfile::tempdir().unwrap();
    let current = dir.path().join("original.exe");
    let candidate = dir.path().join("candidate.exe");
    std::fs::write(&current, b"original").unwrap();
    std::fs::write(&candidate, b"invalid executable").unwrap();
    let installation = Installation::lock(current.clone()).unwrap();
    assert!(
        installation
            .replace(&candidate, &Version::parse("9.9.9").unwrap())
            .await
            .is_err()
    );
    assert_eq!(std::fs::read(current).unwrap(), b"original");
}

// The parent test runs this helper in a disposable copy of the test executable.
// The helper is compiled only for tests; production has no alternative update URL.
#[test]
#[ignore = "invoked by replaces_running_executable_from_verified_download"]
fn replace_helper() {
    let base = std::env::var("FONTINASS_TEST_UPDATE_BASE").unwrap();
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let github = Github::test_server(&base);
        let release = github.latest().await.unwrap();
        let asset = platform_asset(std::env::consts::OS, std::env::consts::ARCH).unwrap();
        let download = github.download(&release, asset).await.unwrap();
        let installation = Installation::current().unwrap();
        installation
            .replace(&download, &release.version)
            .await
            .unwrap();
    });
}

#[tokio::test]
async fn replaces_running_executable_from_verified_download() {
    let dir = tempfile::tempdir().unwrap();
    let candidate = dir.path().join("new-version.exe");
    let source = dir.path().join("fixture.rs");
    std::fs::write(&source, "fn main() { println!(\"fontinass 9.9.9\"); }").unwrap();
    let compiled = std::process::Command::new("rustc")
        .arg("--crate-name")
        .arg("update_fixture")
        .arg(&source)
        .arg("-o")
        .arg(&candidate)
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    // Check the semantic version before touching an installed executable.
    assert!(
        verify_executable(&candidate, &Version::parse("9.9.8").unwrap())
            .await
            .is_err()
    );
    let binary = std::fs::read(&candidate).unwrap();
    let expected = sha256(&binary);
    let name = platform_asset(std::env::consts::OS, std::env::consts::ARCH).unwrap();
    let server = MockServer::new(|base| {
        let mut item=release("cli-v9.9.9");
        item["assets"]=serde_json::json!([
            {"name":name,"size":binary.len(),"digest":format!("sha256:{expected}"),"browser_download_url":format!("{base}/download/cli-v9.9.9/{name}")},
            {"name":"SHA256SUMS","size":100,"browser_download_url":format!("{base}/download/cli-v9.9.9/SHA256SUMS")}
        ]);
        HashMap::from([
            ("/releases".into(),serde_json::to_vec(&vec![item]).unwrap()),
            ("/download/cli-v9.9.9/SHA256SUMS".into(),format!("{expected}  {name}\n").into_bytes()),
            (format!("/download/cli-v9.9.9/{name}"),binary),
        ])
    },Duration::ZERO).await;
    let installed = dir.path().join("fontinass.exe");
    std::fs::copy(std::env::current_exe().unwrap(), &installed).unwrap();
    let result = tokio::time::timeout(
        Duration::from_secs(30),
        tokio::process::Command::new(&installed)
            .args([
                "--exact",
                "update::install::tests::replace_helper",
                "--ignored",
                "--nocapture",
            ])
            .env("FONTINASS_TEST_UPDATE_BASE", &server.base)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(
        result.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
    assert_eq!(sha256(&std::fs::read(&installed).unwrap()), expected);
    let version = tokio::process::Command::new(&installed)
        .arg("--version")
        .output()
        .await
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&version.stdout).trim(),
        "fontinass 9.9.9"
    );
}
