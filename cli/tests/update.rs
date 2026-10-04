use std::process::Command;

#[test]
fn update_and_disable_switches_are_discoverable() {
    let help = Command::new(env!("CARGO_BIN_EXE_fontinass"))
        .arg("--help")
        .output()
        .unwrap();
    assert!(help.status.success());
    let help = String::from_utf8_lossy(&help.stdout);
    assert!(help.contains("update"));
    assert!(help.contains("--no-update-check"));
    let help = Command::new(env!("CARGO_BIN_EXE_fontinass"))
        .args(["update", "--help"])
        .output()
        .unwrap();
    assert!(help.status.success());
    assert!(String::from_utf8_lossy(&help.stdout).contains("--check"));
}

#[cfg(target_os = "linux")]
#[test]
fn startup_checks_skip_scripts_and_support_persistent_opt_out() {
    let dir = tempfile::tempdir().unwrap();
    let invoke = |args: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_fontinass"))
            .env("XDG_CONFIG_HOME", dir.path().join("config"))
            .env("XDG_CACHE_HOME", dir.path().join("cache"))
            .args(args)
            .output()
            .unwrap()
    };
    let set = invoke(&["config", "set", "update-check", "false"]);
    assert!(
        set.status.success(),
        "{}",
        String::from_utf8_lossy(&set.stderr)
    );
    let show = invoke(&["config", "show"]);
    assert!(show.status.success());
    assert!(String::from_utf8_lossy(&show.stdout).contains("update-check: false"));
    assert!(!String::from_utf8_lossy(&show.stderr).contains("Update available"));
    let set = invoke(&["config", "set", "update-check", "true"]);
    assert!(set.status.success());
    let show = invoke(&["config", "show"]);
    assert!(show.status.success());
    assert!(!String::from_utf8_lossy(&show.stderr).contains("Update available"));
    assert!(
        !dir.path()
            .join("cache/fontinass/update-check.json")
            .exists()
    );
    assert!(
        !invoke(&["config", "set", "update-check", "maybe"])
            .status
            .success()
    );
}
