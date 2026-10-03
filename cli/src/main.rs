mod client;
mod config;
mod display;

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use console::Style;
use reqwest::Client;
use walkdir::WalkDir;

use crate::client::{FontNameMode, SubsetOpts, SubsetResult};
use crate::config::Config;
use crate::display::{make_progress, print_result, print_summary};

const SUBTITLE_EXTENSIONS: &[&str] = &["ass", "ssa", "srt"];
const BATCH_SIZE: usize = 10;

#[derive(Parser)]
#[command(
    name = "fontinass",
    version,
    about = "FontInAss CLI — embed fonts into subtitle files"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Process subtitle files: embed fonts via FontInAss server
    Subset {
        /// Input files or glob patterns (e.g. *.ass, subs/*.ssa)
        files: Vec<String>,

        /// Recursively scan directories for subtitle files
        #[arg(short, long)]
        recursive: bool,

        /// Output directory (default: overwrite in place)
        #[arg(short, long)]
        output: Option<PathBuf>,

        /// Server URL (overrides config)
        #[arg(short, long)]
        server: Option<String>,

        /// API key (overrides config)
        #[arg(long)]
        api_key: Option<String>,

        /// Strict mode: fail if any font is missing (code 201/300 → error)
        #[arg(long)]
        strict: bool,

        /// Remove existing embedded fonts before processing
        #[arg(long)]
        clean: bool,

        /// Font naming mode (preserve disables compatibility aliases)
        #[arg(long, value_enum, default_value = "alias")]
        font_name_mode: FontNameMode,

        /// Extra salt for generated alias names (use different values per MKV subtitle track)
        #[arg(long)]
        alias_salt: Option<String>,
    },

    /// Manage CLI configuration
    Config {
        #[command(subcommand)]
        action: ConfigAction,
    },
}

#[derive(Subcommand)]
enum ConfigAction {
    /// Set a config value
    Set {
        /// Key to set (server, api-key)
        key: String,
        /// Value to set
        value: String,
    },
    /// Show current configuration
    Show,
}

/// Resolve input patterns to a list of file paths.
fn resolve_files(patterns: &[String], recursive: bool) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();

    for pattern in patterns {
        let path = Path::new(pattern);

        if path.is_dir() {
            if recursive {
                for entry in WalkDir::new(path).follow_links(true) {
                    let entry = entry?;
                    if entry.file_type().is_file() && is_subtitle(entry.path()) {
                        files.push(entry.into_path());
                    }
                }
            } else {
                // Non-recursive: only immediate children
                for entry in std::fs::read_dir(path)? {
                    let entry = entry?;
                    let p = entry.path();
                    if p.is_file() && is_subtitle(&p) {
                        files.push(p);
                    }
                }
            }
        } else {
            // Glob expansion
            let matches: Vec<_> = glob::glob(pattern)
                .with_context(|| format!("Invalid glob pattern: {}", pattern))?
                .filter_map(|r| r.ok())
                .filter(|p| p.is_file() && is_subtitle(p))
                .collect();
            if matches.is_empty() && Path::new(pattern).is_file() {
                files.push(PathBuf::from(pattern));
            } else {
                files.extend(matches);
            }
        }
    }

    // Deduplicate
    files.sort();
    files.dedup();
    Ok(files)
}

fn is_subtitle(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| SUBTITLE_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Compute output path for a processed file.
fn output_path(original: &Path, output_dir: &Option<PathBuf>) -> PathBuf {
    let mut path = match output_dir {
        Some(dir) => dir.join(original.file_name().unwrap()),
        None => original.to_path_buf(),
    };
    if original
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("srt"))
    {
        path.set_extension("ass");
    }
    path
}

/// Write result data to disk.
fn write_result(result: &SubsetResult, path: &Path) -> Result<()> {
    use std::io::Write;
    let data = result
        .data
        .as_ref()
        .filter(|data| !data.is_empty())
        .context("Server returned no subtitle data")?;
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    std::fs::create_dir_all(parent)?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    if let Ok(metadata) = std::fs::metadata(path) {
        temporary
            .as_file()
            .set_permissions(metadata.permissions())?;
    }
    temporary.write_all(data)?;
    temporary.as_file().sync_all()?;
    temporary
        .persist(path)
        .with_context(|| format!("Failed to write {}", path.display()))?;
    Ok(())
}

async fn run_subset(
    files_patterns: Vec<String>,
    recursive: bool,
    output: Option<PathBuf>,
    server_override: Option<String>,
    api_key_override: Option<String>,
    strict: bool,
    clean: bool,
    font_name_mode: FontNameMode,
    alias_salt: Option<String>,
) -> Result<()> {
    let dim = Style::new().dim();
    let bold = Style::new().bold();

    let cfg = Config::load()?;
    let server = server_override.unwrap_or(cfg.server);
    let api_key = api_key_override.unwrap_or(cfg.api_key);

    if files_patterns.is_empty() {
        bail!("No input files specified. Use `fontinass subset --help` for usage.");
    }

    let files = resolve_files(&files_patterns, recursive)?;
    if files.is_empty() {
        bail!("No subtitle files found matching the given patterns.");
    }

    let mut destinations = std::collections::HashSet::new();
    for file in &files {
        let target = output_path(file, &output);
        if !destinations.insert(target.clone()) || (target != *file && files.contains(&target)) {
            bail!(
                "Output path collision: {}. Use separate output directories.",
                target.display()
            );
        }
    }

    // Validate output dir
    if let Some(ref dir) = output {
        std::fs::create_dir_all(dir)
            .with_context(|| format!("Cannot create output directory: {}", dir.display()))?;
    }

    println!(
        "\n  {} Processing {} file(s) via {}",
        bold.apply_to("fontinass"),
        files.len(),
        dim.apply_to(&server),
    );

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()?;

    let opts = SubsetOpts {
        strict,
        clean,
        font_name_mode,
        alias_salt: alias_salt
            .unwrap_or_default()
            .trim()
            .chars()
            .take(80)
            .collect(),
        api_key,
    };

    let mut all_results: Vec<SubsetResult> = Vec::new();

    if files.len() == 1 {
        // Single file: use raw binary mode
        let result = client::subset_single(&client, &server, &files[0], &opts).await?;
        let out = output_path(&files[0], &output);
        if result.code == 200 || (result.code == 201 && !strict) {
            write_result(&result, &out)?;
        }
        print_result(&result);
        all_results.push(result);
    } else {
        // Batch: group into chunks of BATCH_SIZE
        let pb = make_progress(files.len() as u64);

        for chunk in files.chunks(BATCH_SIZE) {
            let paths: Vec<&Path> = chunk.iter().map(|p| p.as_path()).collect();

            let response = if paths.len() == 1 {
                client::subset_single(&client, &server, paths[0], &opts)
                    .await
                    .map(|result| vec![result])
            } else {
                client::subset_batch(&client, &server, &paths, &opts).await
            };
            match response {
                Ok(results) => {
                    for (i, result) in results.iter().enumerate() {
                        let out = output_path(&chunk[i], &output);
                        if result.code == 200 || (result.code == 201 && !strict) {
                            write_result(result, &out)?;
                        }
                        print_result(result);
                        pb.inc(1);
                    }
                    all_results.extend(results);
                }
                Err(e) => {
                    pb.suspend(|| {
                        let err_style = Style::new().red().bold();
                        eprintln!("  {} Batch error: {}", err_style.apply_to("✗"), e);
                    });
                    // Mark all files in this chunk as failed
                    for path in chunk {
                        let fname = path
                            .file_name()
                            .map(|f| f.to_string_lossy().to_string())
                            .unwrap_or_default();
                        all_results.push(SubsetResult {
                            filename: fname,
                            code: 500,
                            messages: vec![format!("Batch request failed: {}", e)],
                            data: None,
                        });
                        pb.inc(1);
                    }
                }
            }
        }
        pb.finish_and_clear();
    }

    print_summary(&all_results);

    // Exit with non-zero if any failures in strict mode
    let has_errors = all_results.iter().any(|r| r.code >= 300);
    let has_warnings = all_results.iter().any(|r| r.code == 201);
    if strict && (has_errors || has_warnings) {
        std::process::exit(1);
    } else if has_errors {
        std::process::exit(1);
    }

    Ok(())
}

fn run_config(action: ConfigAction) -> Result<()> {
    let dim = Style::new().dim();

    match action {
        ConfigAction::Set { key, value } => {
            let mut cfg = Config::load()?;
            match key.as_str() {
                "server" => cfg.server = value.clone(),
                "api-key" | "api_key" => cfg.api_key = value.clone(),
                _ => bail!("Unknown config key: {}. Valid keys: server, api-key", key),
            }
            cfg.save()?;
            println!(
                "  {} {} = {}",
                Style::new().green().bold().apply_to("✓"),
                key,
                dim.apply_to(if key == "api-key" || key == "api_key" {
                    "(saved)"
                } else {
                    &value
                }),
            );
        }
        ConfigAction::Show => {
            let cfg = Config::load()?;
            let path = Config::path()?;
            println!("  Config: {}", dim.apply_to(path.display()));
            println!("  server:  {}", cfg.server);
            println!(
                "  api-key: {}",
                if cfg.api_key.is_empty() {
                    dim.apply_to("(not set)").to_string()
                } else {
                    format!("{}***", cfg.api_key.chars().take(4).collect::<String>())
                }
            );
        }
    }
    Ok(())
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    let result = match cli.command {
        Commands::Subset {
            files,
            recursive,
            output,
            server,
            api_key,
            strict,
            clean,
            font_name_mode,
            alias_salt,
        } => {
            run_subset(
                files,
                recursive,
                output,
                server,
                api_key,
                strict,
                clean,
                font_name_mode,
                alias_salt,
            )
            .await
        }
        Commands::Config { action } => run_config(action),
    };

    if let Err(e) = result {
        let err_style = Style::new().red().bold();
        eprintln!("\n  {} {:#}", err_style.apply_to("Error:"), e);
        std::process::exit(1);
    }
}
