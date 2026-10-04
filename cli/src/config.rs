use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Config {
    #[serde(default = "default_server")]
    pub server: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_update_check")]
    pub update_check: bool,
}

fn default_update_check() -> bool {
    true
}

fn default_server() -> String {
    "https://font.anibt.net".to_string()
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server: default_server(),
            api_key: String::new(),
            update_check: true,
        }
    }
}

impl Config {
    pub fn path() -> Result<PathBuf> {
        let dir = dirs::config_dir()
            .context("Cannot determine config directory")?
            .join("fontinass");
        Ok(dir.join("config.toml"))
    }

    pub fn load() -> Result<Self> {
        let path = Self::path()?;
        if !path.exists() {
            return Ok(Self::default());
        }
        let content = std::fs::read_to_string(&path)
            .with_context(|| format!("Failed to read {}", path.display()))?;
        let cfg: Config = toml::from_str(&content)
            .with_context(|| format!("Failed to parse {}", path.display()))?;
        Ok(cfg)
    }

    pub fn save(&self) -> Result<()> {
        let path = Self::path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let content = toml::to_string_pretty(self)?;
        std::fs::write(&path, content)
            .with_context(|| format!("Failed to write {}", path.display()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_configuration_keeps_credentials_and_enables_version_checks() {
        let config: Config =
            toml::from_str("server = 'https://example.test'\napi_key = 'fixture-key'\n").unwrap();
        assert_eq!(config.server, "https://example.test");
        assert_eq!(config.api_key, "fixture-key");
        assert!(config.update_check);
    }
}
