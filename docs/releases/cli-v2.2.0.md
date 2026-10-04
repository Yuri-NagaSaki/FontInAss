# FontInAss CLI v2.2.0

新增内置更新命令和启动版本提示，保留 v2.1.0 的字体命名、批处理和写入行为。

## 更新与提示

```bash
fontinass update --check
fontinass update
fontinass --version
```

- `update` 检查本仓库的稳定 `cli-v*` Release，按平台下载、校验大小和 SHA-256，验证可执行版本后替换当前程序。
- `update --check` 只检查，版本相同或当前更高时不降级。
- 交互式命令启动时在后台检查，结束时提示新版本；检查及失败尝试缓存 24 小时，网络预算 1.2 秒。
- CI、非交互输出、帮助/版本和修改配置的命令不进行自动检查；网络失败不影响原命令退出状态。
- 用 `fontinass config set update-check false` 永久关闭，或用 `--no-update-check` / `FONTINASS_NO_UPDATE_CHECK=1` 临时关闭。
- Unix 原子替换，Windows 使用运行中 EXE 替换流程；安装目录需要写入权限，不自动提权。下载和校验失败不修改现有程序，替换失败时保留备份。

**v2.1.0 及更早版本需手动下载一次本版本，之后才能使用 `fontinass update`。**

## 兼容性与交付

- 提供 Linux x64、macOS Intel、macOS Apple Silicon、Windows x64 二进制，附 `SHA256SUMS` 与 `BUILD-INFO.json`。
- 配置中的服务器和凭证保持兼容；新增 `update_check` 默认启用，API key 不发送给 GitHub。
- 在四个平台测试版本选择、校验失败、缓存和真实可执行文件替换，并回归字幕批处理。
- 重写项目与 CLI README，补充部署、配置和 API 接入说明。
- 关闭过期依赖 PR #4：其目标 `quinn-proto 0.11.16` 已被主分支的 `0.11.17` 覆盖，未回退依赖版本。

用法和限制见 [CLI 文档](https://github.com/Yuri-NagaSaki/FontInAss/blob/cli-v2.2.0/cli/README.md)。
