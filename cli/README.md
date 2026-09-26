# fontinass

CLI tool for [FontInAss](https://github.com/Yuri-NagaSaki/FontInAss) — embed fonts into ASS/SSA/SRT subtitle files via a FontInAss server.

## Install

Download the latest binary from [Releases](https://github.com/Yuri-NagaSaki/FontInAss/releases):

| Platform | Binary |
|----------|--------|
| Linux x64 | `fontinass-linux-x64` |
| macOS x64 | `fontinass-macos-x64` |
| macOS ARM | `fontinass-macos-arm64` |
| Windows x64 | `fontinass-windows-x64.exe` |

```bash
# Linux/macOS
chmod +x fontinass-linux-x64
sudo mv fontinass-linux-x64 /usr/local/bin/fontinass

# Windows: add to PATH or use directly
```

## Quick Start

```bash
# Configure server (one-time)
fontinass config set server https://font.anibt.net

# Process a single file (overwrites in place)
fontinass subset file.ass

# Process multiple files
fontinass subset *.ass

# Output to a different directory
fontinass subset -o ./output/ *.ass

# Recursively process all subtitles in a directory
fontinass subset -r ./subs/

# Remove existing embedded fonts first
fontinass subset --clean file.ass

# Strict mode: fail if any font is missing
fontinass subset --strict file.ass

# Multi-track MKV: use different alias salts for different subtitle tracks
fontinass subset --alias-salt SC simple-jp.ass
fontinass subset --alias-salt TC traditional-jp.ass
```

## Commands

### `fontinass subset`

Process subtitle files by embedding fonts.

```
Usage: fontinass subset [OPTIONS] [FILES]...

Arguments:
  [FILES]...  Input files or glob patterns (e.g. *.ass, subs/*.ssa)

Options:
  -r, --recursive          Recursively scan directories
  -o, --output <DIR>       Output directory (default: overwrite in place)
  -s, --server <URL>       Server URL (overrides config)
      --api-key <KEY>      API key (overrides config)
      --strict             Fail if any font is missing
      --clean              Remove existing embedded fonts before processing
      --alias-salt <TEXT>  Extra salt for generated alias names
```

**Supported formats:** `.ass`, `.ssa`, `.srt`

**Batch processing:** Files are sent in batches of 10 per request for efficiency.

### `fontinass config`

Manage CLI configuration.

```bash
# Set server URL
fontinass config set server https://font.anibt.net

# Set API key (if required by server)
fontinass config set api-key YOUR_KEY

# Show current config
fontinass config show
```

Config file location:
- Linux/macOS: `~/.config/fontinass/config.toml`
- Windows: `%APPDATA%\fontinass\config.toml`

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All files processed successfully |
| 1 | One or more files had errors (missing fonts, server error) |

In `--strict` mode, warnings (partial font matches) also cause exit code 1.

## Output Symbols

- `✓` Green — all fonts embedded successfully
- `⚠` Yellow — success with warnings (some fonts missing)
- `✗` Red — processing failed

## Build from Source

```bash
# Requires Rust 1.80+
cd cli
cargo build --release
# Binary at: target/release/fontinass
```

## License

MIT
