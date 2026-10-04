use super::*;
use crate::update::test_support::{MockServer, release};
use std::collections::HashMap;
use std::sync::atomic::Ordering;

#[test]
fn cache_age_and_clock_rollback_are_handled() {
    let cache = CheckCache {
        checked_at: 100,
        latest: None,
    };
    assert!(cache.fresh(101));
    assert!(!cache.fresh(100 + CACHE_TTL));
    assert!(!cache.fresh(99));
    assert!(!CheckCache::default().fresh(1));
}

#[tokio::test]
async fn caches_successful_checks_without_repeating_network_requests() {
    let server = MockServer::new(
        |_| {
            HashMap::from([(
                "/releases".into(),
                serde_json::to_vec(&vec![release("cli-v3.0.0")]).unwrap(),
            )])
        },
        Duration::ZERO,
    )
    .await;
    let github = Github::test_server(&server.base);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("cache.json");
    assert_eq!(
        cached_check(&github, &path, 1000, Duration::from_secs(1))
            .await
            .unwrap()
            .to_string(),
        "3.0.0"
    );
    assert_eq!(
        cached_check(&github, &path, 1001, Duration::from_secs(1))
            .await
            .unwrap()
            .to_string(),
        "3.0.0"
    );
    assert_eq!(server.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn offline_or_slow_checks_preserve_notice_and_are_throttled() {
    let server = MockServer::new(|_| HashMap::new(), Duration::from_secs(1)).await;
    let github = Github::test_server(&server.base);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("cache.json");
    write_cache(
        &path,
        &CheckCache {
            checked_at: 1,
            latest: Some(Version::parse("3.0.0").unwrap()),
        },
    )
    .unwrap();
    let start = std::time::Instant::now();
    let now = CACHE_TTL + 100;
    assert!(
        cached_check(&github, &path, now, Duration::from_millis(30))
            .await
            .is_some()
    );
    assert!(start.elapsed() < Duration::from_millis(500));
    assert!(
        cached_check(&github, &path, now + 1, Duration::from_secs(1))
            .await
            .is_some()
    );
    assert_eq!(server.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn corrupt_cache_and_failed_network_do_not_fail_the_command() {
    let server = MockServer::new(|_| HashMap::new(), Duration::ZERO).await;
    let github = Github::test_server(&server.base);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("cache.json");
    std::fs::write(&path, b"broken cache").unwrap();
    assert!(
        cached_check(&github, &path, 1000, Duration::from_secs(1))
            .await
            .is_none()
    );
    assert!(
        cached_check(&github, &path, 1001, Duration::from_secs(1))
            .await
            .is_none()
    );
    assert_eq!(server.calls.load(Ordering::SeqCst), 1);
}
