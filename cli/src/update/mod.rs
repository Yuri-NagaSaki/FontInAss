mod install;
mod notice;
mod release;
#[cfg(test)]
mod test_support;

use anyhow::Result;
use semver::Version;

pub use notice::StartupCheck;

pub async fn run(check_only: bool) -> Result<()> {
    let current = Version::parse(env!("CARGO_PKG_VERSION"))?;
    let asset = release::platform_asset(std::env::consts::OS, std::env::consts::ARCH)?;
    println!("Checking for CLI updates (current {current})…");
    let github = release::Github::new()?;
    let latest = github.latest().await?;
    if !latest.newer_than(&current) {
        println!("You are up to date ({current}).");
        return Ok(());
    }
    if check_only {
        println!(
            "Update available: {current} → {}. Run `fontinass update` to install.",
            latest.version
        );
        return Ok(());
    }
    let installation = install::Installation::current()?;
    // A second process may have updated this path after our metadata request.
    if !latest.newer_than(&installation.installed_version().await?) {
        println!("The installed executable is already up to date.");
        return Ok(());
    }
    println!("Downloading {} ({asset})…", latest.version);
    let download = github.download(&latest, asset).await?;
    println!("SHA-256 verified. Installing…");
    installation.replace(&download, &latest.version).await?;
    println!(
        "Updated to {} at {}",
        latest.version,
        installation.path.display()
    );
    Ok(())
}
