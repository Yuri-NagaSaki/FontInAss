use console::Style;
use indicatif::{ProgressBar, ProgressStyle};
use std::collections::BTreeMap;

use crate::client::SubsetResult;

// Server status codes mirrored from server/src/types.ts
const CODE_OK: u16 = 200;
const CODE_WARN: u16 = 201;
const CODE_MISSING_FONT: u16 = 300;

/// Create a progress bar for batch processing.
pub fn make_progress(total: u64) -> ProgressBar {
    let pb = ProgressBar::new(total);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.magenta} [{bar:30.magenta/dim}] {pos}/{len} {msg}")
            .unwrap()
            .progress_chars("━╸─"),
    );
    pb
}

/// Categorise messages emitted by the server into structured buckets.
struct Categorised<'a> {
    missing_fonts: Vec<&'a str>,
    missing_glyphs: Vec<(&'a str, &'a str)>,
    other: Vec<&'a str>,
}

fn categorise<'a>(messages: &'a [String]) -> Categorised<'a> {
    let mut out = Categorised {
        missing_fonts: vec![],
        missing_glyphs: vec![],
        other: vec![],
    };
    for m in messages {
        // Format from server: "Missing font: [Font Name]"
        if let Some(rest) = m.strip_prefix("Missing font: ") {
            let name = rest.trim().trim_start_matches('[').trim_end_matches(']');
            out.missing_fonts.push(name);
        // "Failed to load font: [Font Name]"
        } else if let Some(rest) = m.strip_prefix("Failed to load font: ") {
            let name = rest.trim().trim_start_matches('[').trim_end_matches(']');
            out.missing_fonts.push(name);
        // "Missing glyphs in [Font Name]: 字符1,字符2"
        } else if let Some(rest) = m.strip_prefix("Missing glyphs in ") {
            if let Some((name_part, glyphs)) = rest.split_once("]: ") {
                let name = name_part.trim_start_matches('[');
                out.missing_glyphs.push((name, glyphs));
            } else {
                out.other.push(m);
            }
        } else {
            out.other.push(m);
        }
    }
    out
}

/// Print result for a single file.
pub fn print_result(result: &SubsetResult) {
    let ok_style = Style::new().green().bold();
    let warn_style = Style::new().yellow().bold();
    let err_style = Style::new().red().bold();
    let dim = Style::new().dim();
    let label_missing = Style::new().red();
    let label_glyph = Style::new().yellow();
    let font_name_style = Style::new().cyan().bold();

    let cats = categorise(&result.messages);

    let icon = match result.code {
        CODE_OK => ok_style.apply_to("✓").to_string(),
        CODE_WARN => warn_style.apply_to("⚠").to_string(),
        CODE_MISSING_FONT => err_style.apply_to("✗").to_string(),
        _ => err_style.apply_to("✗").to_string(),
    };

    let size = result
        .data
        .as_ref()
        .map(|d| format_size(d.len()))
        .unwrap_or_else(|| "—".to_string());

    let suffix = match result.code {
        CODE_OK | CODE_WARN => dim.apply_to(format!("({})", size)).to_string(),
        CODE_MISSING_FONT => err_style.apply_to(format!("[code {} · 缺字体]", result.code)).to_string(),
        _ => err_style.apply_to(format!("[code {}]", result.code)).to_string(),
    };

    println!("  {} {} {}", icon, result.filename, suffix);

    // Missing fonts — most important; show as bullet list with cyan font names
    if !cats.missing_fonts.is_empty() {
        println!(
            "      {} {}",
            label_missing.apply_to("缺失字体:"),
            dim.apply_to(format!("({})", cats.missing_fonts.len())),
        );
        for name in &cats.missing_fonts {
            println!("        · {}", font_name_style.apply_to(name));
        }
    }

    // Missing glyphs — show font name + truncated character preview
    if !cats.missing_glyphs.is_empty() {
        println!("      {}", label_glyph.apply_to("缺失字形:"));
        for (name, glyphs) in &cats.missing_glyphs {
            let preview = truncate_chars(glyphs, 30);
            println!(
                "        · {} {}",
                font_name_style.apply_to(name),
                dim.apply_to(format!("({})", preview)),
            );
        }
    }

    // Other diagnostic messages
    for msg in &cats.other {
        let style = if result.code >= 300 { &err_style } else { &dim };
        println!("      {} {}", dim.apply_to("›"), style.apply_to(msg));
    }
}

/// Print summary after all files processed.
pub fn print_summary(results: &[SubsetResult]) {
    let ok_style = Style::new().green().bold();
    let warn_style = Style::new().yellow().bold();
    let err_style = Style::new().red().bold();
    let dim = Style::new().dim();
    let header_style = Style::new().bold();
    let font_name_style = Style::new().cyan().bold();

    let ok = results.iter().filter(|r| r.code == CODE_OK).count();
    let warn = results.iter().filter(|r| r.code == CODE_WARN).count();
    let missing = results.iter().filter(|r| r.code == CODE_MISSING_FONT).count();
    let fail = results.iter().filter(|r| r.code >= 300 && r.code != CODE_MISSING_FONT).count();

    println!();
    println!(
        "  {} {} ok  {} {} warn  {} {} 缺字体  {} {} fail  {} {} total",
        ok_style.apply_to("●"),
        ok,
        warn_style.apply_to("●"),
        warn,
        err_style.apply_to("●"),
        missing,
        err_style.apply_to("●"),
        fail,
        dim.apply_to("●"),
        results.len(),
    );

    // Aggregate missing fonts across all files: name -> Vec<file>
    let mut missing_index: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut glyph_index: BTreeMap<String, Vec<(String, String)>> = BTreeMap::new();

    for r in results {
        let cats = categorise(&r.messages);
        for name in cats.missing_fonts {
            missing_index
                .entry(name.to_string())
                .or_default()
                .push(r.filename.clone());
        }
        for (name, glyphs) in cats.missing_glyphs {
            glyph_index
                .entry(name.to_string())
                .or_default()
                .push((r.filename.clone(), glyphs.to_string()));
        }
    }

    if !missing_index.is_empty() {
        println!();
        println!(
            "  {} {} {}",
            err_style.apply_to("✗"),
            header_style.apply_to("缺失字体汇总"),
            dim.apply_to(format!("({} 款)", missing_index.len())),
        );
        for (name, files) in &missing_index {
            println!(
                "    {} {}  {}",
                font_name_style.apply_to(name),
                dim.apply_to(format!("× {}", files.len())),
                dim.apply_to(format!("({})", truncate_files(files, 3))),
            );
        }
        println!(
            "  {} 在服务端 /fonts 目录下放入对应字体后，运行索引重建即可解决。",
            dim.apply_to("提示"),
        );
    }

    if !glyph_index.is_empty() {
        println!();
        println!(
            "  {} {} {}",
            warn_style.apply_to("⚠"),
            header_style.apply_to("缺失字形汇总"),
            dim.apply_to(format!("({} 款)", glyph_index.len())),
        );
        for (name, entries) in &glyph_index {
            println!(
                "    {} {}",
                font_name_style.apply_to(name),
                dim.apply_to(format!("× {} 文件", entries.len())),
            );
        }
    }
}

fn truncate_chars(s: &str, max: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= max {
        s.to_string()
    } else {
        let head: String = chars.iter().take(max).collect();
        format!("{}… +{}", head, chars.len() - max)
    }
}

fn truncate_files(files: &[String], max: usize) -> String {
    if files.len() <= max {
        files.join(", ")
    } else {
        let head: Vec<&str> = files.iter().take(max).map(|s| s.as_str()).collect();
        format!("{}, +{} more", head.join(", "), files.len() - max)
    }
}

fn format_size(bytes: usize) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}
