use std::cmp::Ordering;
use std::io::Write;
use std::time::Duration;

use anyhow::{Context, Result, bail, ensure};
use reqwest::{Client, Response, Url};
use semver::Version;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tempfile::{NamedTempFile, TempPath};

const RELEASES_API: &str =
    "https://api.github.com/repos/Yuri-NagaSaki/FontInAss/releases?per_page=100";
const DOWNLOAD_ROOT: &str = "https://github.com/Yuri-NagaSaki/FontInAss/releases/download/";
const MAX_BINARY_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize)]
pub(super) struct Asset {
    pub name: String,
    pub size: u64,
    pub browser_download_url: String,
    pub digest: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}

#[derive(Clone, Debug)]
pub(super) struct Release {
    pub version: Version,
    tag: String,
    assets: Vec<Asset>,
}

impl Release {
    pub fn newer_than(&self, current: &Version) -> bool {
        self.version.cmp_precedence(current) == Ordering::Greater
    }

    fn asset(&self, name: &str) -> Result<&Asset> {
        let matches: Vec<_> = self
            .assets
            .iter()
            .filter(|asset| asset.name == name)
            .collect();
        ensure!(
            matches.len() == 1,
            "Release {} must contain exactly one {name} asset",
            self.tag
        );
        Ok(matches[0])
    }
}

pub(super) struct Github {
    client: Client,
    api: String,
    download_root: Url,
}

impl Github {
    pub fn new() -> Result<Self> {
        let client = Client::builder()
            .user_agent(concat!("FontInAss/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(120))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                let url = attempt.url();
                if attempt.previous().len() >= 5 {
                    attempt.error("Too many update redirects")
                } else if url.scheme() == "https"
                    && matches!(
                        url.host_str(),
                        Some(
                            "github.com"
                                | "api.github.com"
                                | "release-assets.githubusercontent.com"
                                | "objects.githubusercontent.com"
                                | "github-releases.githubusercontent.com"
                        )
                    )
                {
                    attempt.follow()
                } else {
                    attempt.error("Untrusted update redirect")
                }
            }))
            .build()?;
        Ok(Self {
            client,
            api: RELEASES_API.to_owned(),
            download_root: Url::parse(DOWNLOAD_ROOT)?,
        })
    }

    pub async fn latest(&self) -> Result<Release> {
        let response = self
            .client
            .get(&self.api)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .timeout(Duration::from_secs(10))
            .send()
            .await?
            .error_for_status()
            .context("Cannot check GitHub releases")?;
        select_release(&read_bounded(response, 4 * 1024 * 1024).await?)
    }

    fn asset_url(&self, release: &Release, asset: &Asset) -> Result<Url> {
        let mut expected = self.download_root.clone();
        expected
            .path_segments_mut()
            .map_err(|_| anyhow::anyhow!("Invalid download base"))?
            .pop_if_empty()
            .push(&release.tag)
            .push(&asset.name);
        ensure!(
            Url::parse(&asset.browser_download_url)? == expected,
            "Unexpected download URL for {}",
            asset.name
        );
        Ok(expected)
    }

    pub async fn download(&self, release: &Release, name: &str) -> Result<TempPath> {
        let asset = release.asset(name)?;
        ensure!(
            asset.size > 0 && asset.size <= MAX_BINARY_BYTES,
            "Invalid update binary size"
        );
        let checksum_asset = release.asset("SHA256SUMS")?;
        let checksum_response = self
            .client
            .get(self.asset_url(release, checksum_asset)?)
            .timeout(Duration::from_secs(20))
            .send()
            .await?
            .error_for_status()?;
        let checksums = read_bounded(checksum_response, 64 * 1024).await?;
        let expected = checksum_for(std::str::from_utf8(&checksums)?, name)?;
        if let Some(digest) = &asset.digest {
            ensure!(
                digest == &format!("sha256:{expected}"),
                "GitHub digest and SHA256SUMS disagree"
            );
        }
        let response = self
            .client
            .get(self.asset_url(release, asset)?)
            .send()
            .await?
            .error_for_status()?;
        let mut temporary = tempfile::Builder::new()
            .prefix("fontinass-update-")
            .suffix(".exe")
            .tempfile()?;
        download_checked(response, &mut temporary, asset.size, &expected).await?;
        // Executing a file still open for writing fails with ETXTBSY on Unix.
        Ok(temporary.into_temp_path())
    }

    #[cfg(test)]
    pub fn test_server(base: &str) -> Self {
        Self {
            client: Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(2))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap(),
            api: format!("{base}/releases"),
            download_root: Url::parse(&format!("{base}/download/")).unwrap(),
        }
    }
}

pub(super) fn platform_asset(os: &str, arch: &str) -> Result<&'static str> {
    match (os, arch) {
        ("linux", "x86_64") => Ok("fontinass-linux-x64"),
        ("macos", "x86_64") => Ok("fontinass-macos-x64"),
        ("macos", "aarch64") => Ok("fontinass-macos-arm64"),
        ("windows", "x86_64") => Ok("fontinass-windows-x64.exe"),
        _ => bail!("Automatic updates are not available for {os}/{arch}; use a source build"),
    }
}

fn select_release(bytes: &[u8]) -> Result<Release> {
    let releases: Vec<GithubRelease> =
        serde_json::from_slice(bytes).context("Invalid GitHub release response")?;
    releases
        .into_iter()
        .filter(|release| !release.draft && !release.prerelease)
        .filter_map(|release| {
            let version = Version::parse(release.tag_name.strip_prefix("cli-v")?).ok()?;
            if !version.pre.is_empty() {
                return None;
            }
            Some(Release {
                version,
                tag: release.tag_name,
                assets: release.assets,
            })
        })
        .max_by(|a, b| a.version.cmp_precedence(&b.version))
        .context("No stable CLI release found on GitHub")
}

fn checksum_for(manifest: &str, filename: &str) -> Result<String> {
    let mut found = None;
    for line in manifest.lines() {
        let fields: Vec<_> = line.split_whitespace().collect();
        if fields.len() != 2 || fields[1].trim_start_matches('*') != filename {
            continue;
        }
        ensure!(found.is_none(), "Duplicate checksum for {filename}");
        ensure!(
            fields[0].len() == 64 && fields[0].bytes().all(|c| c.is_ascii_hexdigit()),
            "Invalid SHA-256 checksum for {filename}"
        );
        found = Some(fields[0].to_ascii_lowercase());
    }
    found.with_context(|| format!("SHA256SUMS has no checksum for {filename}"))
}

async fn read_bounded(mut response: Response, maximum: usize) -> Result<Vec<u8>> {
    ensure!(
        response
            .content_length()
            .is_none_or(|size| size <= maximum as u64),
        "Update response is too large"
    );
    let mut data = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        ensure!(
            data.len() + chunk.len() <= maximum,
            "Update response is too large"
        );
        data.extend_from_slice(&chunk);
    }
    Ok(data)
}

async fn download_checked(
    mut response: Response,
    output: &mut NamedTempFile,
    size: u64,
    expected: &str,
) -> Result<()> {
    ensure!(
        response
            .content_length()
            .is_none_or(|length| length == size),
        "Update download size does not match release metadata"
    );
    let mut received = 0u64;
    let mut hash = Sha256::new();
    while let Some(chunk) = response.chunk().await? {
        received += chunk.len() as u64;
        ensure!(received <= size, "Update download exceeds expected size");
        hash.update(&chunk);
        output.write_all(&chunk)?;
    }
    ensure!(received == size, "Update download is incomplete");
    let actual: String = hash
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    ensure!(
        actual == expected,
        "SHA-256 verification failed; current executable was not changed"
    );
    output.as_file().sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests;
