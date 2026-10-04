# FontInAss CLI v2.1.0

本次发布修复批处理和文件写入问题，并提供字体命名模式选项。CLI 继续使用 v2 `/api/subset` 协议，无需重新配置已有服务器地址或凭证。

## 更新内容

- 新增 `--font-name-mode alias|preserve`。默认使用兼容别名，`preserve` 保留原始字体名称；单文件和批量请求均传递该选项。
- 修复 `10n+1` 个文件批处理时最后一个文件的响应解析错误。
- 输出先写入临时文件并同步，再原子替换目标文件；批量写入错误会明确报告并退出失败。
- 严格模式遇到缺字警告时不写入结果文件。
- 在请求前检测输出路径冲突，避免来自不同目录的同名文件互相覆盖。
- 校验批量响应数量、次序、base64 和成功响应的数据，避免错误结果写到其他文件。
- SRT 处理结果使用 `.ass` 扩展名，保留原始 `.srt` 文件。
- 设置 API key 时不再回显完整密钥，显示配置时避免按 UTF-8 字节截断字符串。

## 使用示例

```bash
# 保留字体名称，并写入独立输出目录
fontinass subset --font-name-mode preserve --strict -o ./output/ *.ass

# 重新处理已经嵌入字体的字幕
fontinass subset --font-name-mode preserve --strict --clean -o ./output/ *.ass
```

从兼容别名恢复原名需要字幕保留 `; Font Subset: ALIAS - OriginalFontName` 注释，且服务器能找到原始字体。请使用已包含本次修复的 FontInAss 服务端；在线服务 `https://font.anibt.net` 已部署。`--strict` 和 `--clean` 不改变字体命名模式。

## 下载与校验

| 平台 | 文件 |
| --- | --- |
| Linux x64 | `fontinass-linux-x64` |
| macOS Intel | `fontinass-macos-x64` |
| macOS Apple Silicon | `fontinass-macos-arm64` |
| Windows x64 | `fontinass-windows-x64.exe` |

另附 `SHA256SUMS` 和 `BUILD-INFO.json`，记录各文件的 SHA-256 和构建提交。下载对应平台的二进制并替换已安装版本；Unix 系统需要添加可执行权限。

```bash
chmod +x fontinass-linux-x64
./fontinass-linux-x64 --version
# fontinass 2.1.0

# Linux：SHA256SUMS 与二进制放在同一目录
sha256sum --ignore-missing -c SHA256SUMS
```

发布前对四个目标平台分别运行 CLI 集成测试、锁定依赖构建和版本检查。Bun 1.4.2 与字体处理性能优化属于服务端更新；CLI 本身是 Rust 二进制，无需安装 Bun。
