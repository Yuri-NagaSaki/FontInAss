use std::io::{IsTerminal, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use semver::Version;
use serde::{Deserialize, Serialize};
use tokio::task::JoinHandle;

use super::release::{Github, platform_asset};
use crate::config::Config;

const CACHE_TTL: u64 = 24 * 60 * 60;
const CHECK_BUDGET: Duration = Duration::from_millis(1200);

#[derive(Default, Serialize, Deserialize)]
struct CheckCache {
    checked_at: u64,
    latest: Option<Version>,
}

impl CheckCache {
    fn fresh(&self, now: u64) -> bool {
        self.checked_at > 0
            && now
                .checked_sub(self.checked_at)
                .is_some_and(|elapsed| elapsed < CACHE_TTL)
    }
}

/// Check in parallel with the command; report after its progress output is done.
pub struct StartupCheck(Option<JoinHandle<Option<Version>>>);

impl StartupCheck {
    pub fn begin(disabled: bool) -> Self {
        if disabled
            || !std::io::stderr().is_terminal()
            || std::env::var_os("CI").is_some()
            || std::env::var_os("FONTINASS_NO_UPDATE_CHECK").is_some_and(|value| value != "0")
            || !Config::load()
                .map(|config| config.update_check)
                .unwrap_or(false)
            || platform_asset(std::env::consts::OS, std::env::consts::ARCH).is_err()
        {
            return Self(None);
        }
        let Some(path) = cache_path() else {
            return Self(None);
        };
        Self(Some(tokio::spawn(async move {
            let github = Github::new().ok()?;
            cached_check(&github, &path, now_seconds(), CHECK_BUDGET).await
        })))
    }

    pub async fn finish(self) {
        let Some(task) = self.0 else {
            return;
        };
        if let Ok(Some(latest)) = task.await {
            let current = Version::parse(env!("CARGO_PKG_VERSION")).expect("valid package version");
            if latest.cmp_precedence(&current).is_gt() {
                eprintln!(
                    "\n  Update available: {current} → {latest}. Run `fontinass update` to install."
                );
            }
        }
    }
}

fn cache_path() -> Option<PathBuf> {
    Some(
        dirs::cache_dir()?
            .join("fontinass")
            .join("update-check.json"),
    )
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

async fn cached_check(github: &Github, path: &Path, now: u64, budget: Duration) -> Option<Version> {
    let cached: CheckCache = std::fs::File::open(path)
        .ok()
        .and_then(|file| {
            let mut bytes = Vec::new();
            file.take(4097).read_to_end(&mut bytes).ok()?;
            Some(bytes)
        })
        .filter(|bytes| bytes.len() <= 4096)
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    if cached.fresh(now) {
        return cached.latest;
    }
    // Timestamp failed attempts too: an offline machine must not wait every launch.
    let latest = match tokio::time::timeout(budget, github.latest()).await {
        Ok(Ok(release)) => Some(release.version),
        _ => cached.latest,
    };
    let state = CheckCache {
        checked_at: now,
        latest: latest.clone(),
    };
    let _ = write_cache(path, &state);
    latest
}

fn write_cache(path: &Path, state: &CheckCache) -> anyhow::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Invalid update cache path"))?;
    std::fs::create_dir_all(parent)?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    temporary.write_all(&serde_json::to_vec(state)?)?;
    temporary.persist(path)?;
    Ok(())
}

#[cfg(test)]
mod tests;
