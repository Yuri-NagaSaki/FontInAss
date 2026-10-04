use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{Context, Result, ensure};
use semver::Version;

pub(super) struct Installation {
    pub path: PathBuf,
    _lock: File,
}

impl Installation {
    pub fn current() -> Result<Self> {
        let path = std::env::current_exe()?.canonicalize()?;
        Self::lock(path)
    }

    fn lock(path: PathBuf) -> Result<Self> {
        let parent = path
            .parent()
            .context("Executable has no parent directory")?;
        let filename = path
            .file_name()
            .context("Executable has no filename")?
            .to_string_lossy();
        let lock_path = parent.join(format!(".{filename}.update.lock"));
        let lock = OpenOptions::new().read(true).write(true).create(true).truncate(false).open(&lock_path)
            .with_context(|| format!("Cannot update {}. Run with permission to write to this installation, or install in a writable directory", path.display()))?;
        lock.try_lock().map_err(|error| {
            anyhow::anyhow!("Cannot lock updater (another update may be running): {error}")
        })?;
        // Keep the empty lock file: unlinking it would allow concurrent processes
        // to acquire locks on different inodes with the same filename.
        Ok(Self { path, _lock: lock })
    }

    pub async fn replace(&self, candidate: &Path, version: &Version) -> Result<()> {
        verify_executable(candidate, version).await?;
        replace_current(candidate, &self.path)
    }

    pub async fn installed_version(&self) -> Result<Version> {
        let output = executable_version(&self.path).await?;
        Version::parse(
            output
                .trim()
                .strip_prefix("fontinass ")
                .context("Installed executable returned an invalid version")?,
        )
        .context("Installed executable returned an invalid version")
    }
}

fn replace_current(candidate: &Path, current: &Path) -> Result<()> {
    // Windows replacement moves the running image aside first. Keep an independent
    // backup so a later copy/rename failure cannot remove the only working binary.
    let directory = tempfile::Builder::new()
        .prefix(".fontinass-backup-")
        .tempdir_in(
            current
                .parent()
                .context("Executable has no parent directory")?,
        )?;
    let backup = directory.path().join("fontinass.exe");
    let mut backup_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&backup)?;
    std::io::copy(&mut File::open(current)?, &mut backup_file)
        .context("Cannot back up the current executable")?;
    backup_file.sync_all()?;
    drop(backup_file);
    std::fs::set_permissions(&backup, current.metadata()?.permissions())?;
    if let Err(error) = self_replace::self_replace(candidate) {
        if !current.exists() {
            let _ = std::fs::copy(&backup, current);
        }
        let kept = directory.keep();
        anyhow::bail!(
            "Could not replace {}: {error}. Previous binary retained at {}",
            current.display(),
            kept.join("fontinass.exe").display()
        );
    }
    Ok(())
}

async fn verify_executable(candidate: &Path, version: &Version) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(candidate, std::fs::Permissions::from_mode(0o700))?;
    }
    let output = executable_version(candidate).await?;
    ensure!(
        output.trim() == format!("fontinass {version}"),
        "Downloaded executable does not report version {version}; current executable was not changed"
    );
    Ok(())
}

async fn executable_version(candidate: &Path) -> Result<String> {
    let output = tokio::time::timeout(
        Duration::from_secs(5),
        tokio::process::Command::new(candidate)
            .arg("--version")
            .env("FONTINASS_NO_UPDATE_CHECK", "1")
            .kill_on_drop(true)
            .output(),
    )
    .await
    .context("Downloaded executable version check timed out")?
    .context(
        "Downloaded executable cannot run on this system; current executable was not changed",
    )?;
    ensure!(
        output.status.success(),
        "Executable version check failed; current executable was not changed"
    );
    String::from_utf8(output.stdout).context("Invalid version output")
}

#[cfg(test)]
mod tests;
