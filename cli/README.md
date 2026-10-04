# FontInAss CLI

FontInAss CLI 将字幕发送到 FontInAss 服务，取得嵌入字体子集的字幕并写入本地。支持 ASS、SSA、SRT、目录扫描和批量请求。CLI 使用 Rust 编写，运行时不需要 Bun 或 Python；它需要能访问对应的 FontInAss 服务端。

当前版本：**[v2.2.0](https://github.com/Yuri-NagaSaki/FontInAss/releases/tag/cli-v2.2.0)**。

## 安装

从 [GitHub Releases](https://github.com/Yuri-NagaSaki/FontInAss/releases/latest) 下载当前系统对应的文件：

| 平台 | 文件 |
| --- | --- |
| Linux x64 | `fontinass-linux-x64` |
| macOS Intel | `fontinass-macos-x64` |
| macOS Apple Silicon | `fontinass-macos-arm64` |
| Windows x64 | `fontinass-windows-x64.exe` |

Linux 示例：

```bash
curl -fL https://github.com/Yuri-NagaSaki/FontInAss/releases/latest/download/fontinass-linux-x64 -o fontinass
chmod +x fontinass
mkdir -p "$HOME/.local/bin"
mv fontinass "$HOME/.local/bin/fontinass"
# 确保 ~/.local/bin 已加入 PATH
fontinass --version
```

macOS 下载对应架构文件，改名为 `fontinass`，添加执行权限后放入 `PATH`。Windows 下载后改名为 `fontinass.exe`，在当前目录运行或把所在目录加入 `PATH`。其他操作系统或架构可尝试源码构建，不支持自动下载更新。

Release 附带 `SHA256SUMS` 和 `BUILD-INFO.json`。下载清单后，Linux 可在二进制所在目录运行 `sha256sum --ignore-missing -c SHA256SUMS`；macOS 可用 `shasum -a 256 文件名`，Windows 可用 `Get-FileHash 文件名 -Algorithm SHA256`，对照清单中的值。

## 更新

```bash
fontinass update --check
fontinass update
fontinass --version
```

`update --check` 只查询版本，`update` 下载并安装较新的稳定 CLI Release。版本比较使用语义化版本号；草稿、预发布和服务端的 `v*` 标签不会作为 CLI 更新，不会主动降级。

更新步骤：

1. 从本仓库 GitHub Release API 查找稳定 `cli-v*` 版本。
2. 选择当前程序平台对应的文件，取得 `SHA256SUMS`。
3. 下载到临时文件，核对大小和 SHA-256；有 GitHub asset digest 时同时校验。
4. 执行下载文件的 `--version`，确认平台可运行且版本与 Release 一致。
5. 保留旧程序备份后替换当前可执行文件。Unix 使用原子替换；Windows 使用专门处理运行中 EXE 的替换流程。

下载、校验、版本检查失败时不替换旧程序；替换阶段失败时报告保留备份的位置。安装目录需要写入权限，CLI 不会自动调用 `sudo` 或请求管理员权限。同一安装位置的并发更新受文件锁保护；目录中保留一个空的 `.fontinass.update.lock` 文件属于正常行为，实际文件名取决于程序名称。

**v2.1.0 及更早版本没有自更新命令。先从 Release 手动安装一次 v2.2.0，之后即可运行 `fontinass update`。**

### 启动检查与提示

在交互式终端运行 `subset` 或 `config show` 时，默认启动后台版本检查，提示放在命令结果之后，不打断进度条。

- 检查结果和失败尝试缓存 24 小时，网络总预算为 1.2 秒。
- 没有更新时不额外显示消息；断网、限流、损坏缓存或缓存目录不可写时，不使原命令失败。
- 缓存目录可写时，失败检查也会在 24 小时内跳过重试；目录不可写时无法持久化缓存。
- CI、非交互 stderr、`--help`、`--version` 和修改配置的命令不执行自动检查。
- 启动检查不会下载或安装程序；只有显式 `update` 会安装。
- 显式 `update --check` 每次查询 GitHub，不使用启动检查缓存，网络失败会以非零状态退出。

```bash
# 永久关闭／重新启用
fontinass config set update-check false
fontinass config set update-check true

# 单次关闭，选项可放在子命令前后
fontinass --no-update-check subset --strict -o ./output/ input.ass

# Unix 环境变量方式
FONTINASS_NO_UPDATE_CHECK=1 fontinass subset -o ./output/ input.ass
```

PowerShell 使用 `$env:FONTINASS_NO_UPDATE_CHECK = '1'`。该变量设置为 `0` 时不关闭检查。它只控制启动检查，不禁用显式 `update` 命令。

## 配置服务器

```bash
# 默认为公开在线服务
fontinass config set server https://font.anibt.net

# 自建服务可替换地址
fontinass config set server http://127.0.0.1:3300

# 配置需要的密钥
fontinass config set api-key YOUR_KEY

fontinass config show
```

字幕处理接口本身是公共接口；`--api-key` 仍可用于需要该头的部署。命令行 `--server`、`--api-key` 覆盖持久化配置；配置中的 API key 不会发送到 GitHub 更新接口。

| 系统 | 配置文件 | 更新检查缓存 |
| --- | --- | --- |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/fontinass/config.toml` | `${XDG_CACHE_HOME:-~/.cache}/fontinass/update-check.json` |
| macOS | `~/Library/Application Support/fontinass/config.toml` | `~/Library/Caches/fontinass/update-check.json` |
| Windows | `%APPDATA%\fontinass\config.toml` | `%LOCALAPPDATA%\fontinass\update-check.json` |

配置包含 `server`、`api_key`、`update_check`；旧配置缺少 `update_check` 时默认启用。`config show` 掩码显示密钥，但配置文件本身保存密钥原文，需妥善保管。

## 处理字幕

```bash
# 单文件，推荐先写到独立目录
fontinass subset --strict -o ./output/ input.ass

# 多文件
fontinass subset --strict -o ./output/ *.ass

# 递归扫描 .ass、.ssa、.srt
fontinass subset -r --strict -o ./output/ ./subs/

# 使用指定服务器
fontinass subset -s http://127.0.0.1:3300 -o ./output/ input.ass
```

默认每批最多 10 个文件，最后一批只有一个文件时使用单文件协议。不指定 `-o` 时，成功的 ASS/SSA 结果替换原文件；SRT 写为同名 `.ass`，原 `.srt` 保留。输出目录是平铺目录，不保留输入的子目录结构；遇到重名路径时在发请求前报错。

文件先写入同目录临时文件并同步，再替换目标文件。部分文件失败不会回滚已成功写入的其他文件。网络或磁盘错误返回非零退出码。

### 参数

| 参数 | 用途 |
| --- | --- |
| `-r, --recursive` | 递归扫描目录 |
| `-o, --output <DIR>` | 指定输出目录；默认原位替换 ASS/SSA |
| `-s, --server <URL>` | 覆盖服务器地址 |
| `--api-key <KEY>` | 覆盖配置中的密钥 |
| `--strict` | 缺失字体或字形时视为失败，不写警告结果 |
| `--clean` | 请求服务端清除已有内嵌字体后重新处理 |
| `--font-name-mode alias\|preserve` | 字体命名模式，默认 `alias` |
| `--alias-salt <TEXT>` | 为不同字幕轨设置不同的别名盐，最多 80 个字符 |
| `--no-update-check` | 本次不执行启动版本检查 |

SRT 使用服务端默认样式；当前 CLI 不提供自定义 SRT 样式选项。完整帮助可通过 `fontinass subset --help` 查看。

### 原名与别名

```bash
# 保留原字体名
fontinass subset --font-name-mode preserve --strict -o ./output/ input.ass

# 已子集化字幕恢复原名并重新嵌入
fontinass subset --font-name-mode preserve --strict --clean -o ./output/ input.ass

# 多轨 MKV，分别生成别名
fontinass subset --alias-salt SC -o ./sc-output/ simple.ass
fontinass subset --alias-salt TC -o ./tc-output/ traditional.ass
```

别名模式同时改写字幕引用和嵌入字体的家族名称；保名模式保留原始引用。`--strict` 和 `--clean` 不改变命名模式。

恢复原名依赖 `; Font Subset: ALIAS - OriginalFontName` 注释及服务器上的原始字体。仅用其他工具改写 ASS 中的字体名不会同步改写内嵌字体数据；恢复后应重新处理，保持两者一致。`preserve` 下多轨同名字体的冲突仍需自行处理。

## 退出状态与排错

| 退出码 | 含义 |
| --- | --- |
| `0` | 命令成功；普通模式允许带警告的字幕结果 |
| `1` | 请求、处理、写入或更新失败；严格模式警告也视为失败 |
| `2` | 参数错误，例如未知字体命名模式 |

| 现象 | 处理方式 |
| --- | --- |
| `Missing font` | 向服务器补充对应字体并建立索引 |
| `Missing glyphs` | 确认选中的字体确实包含这些字符，或调整字幕字体 |
| 已有内嵌字体 | 确认需要重新生成后加 `--clean` |
| 输出路径冲突 | 为同名文件分开输出目录 |
| 服务器繁忙，HTTP 503 | 等待后重试；服务端限制全局处理并发 |
| GitHub 检查失败 | 检查网络或限流；不影响普通字幕处理 |
| 更新目录不可写 | 用有写权限的账户更新，或安装到用户可写目录 |
| SHA-256 或版本检查失败 | 当前程序未替换；重新下载或查看 Release 文件与说明 |

## 从源码构建

使用当前 stable Rust。代码采用 edition 2024，文件锁接口要求 Rust 1.89 或更新版本；锁文件可能进一步约束依赖所需版本。

```bash
cargo test --locked --manifest-path cli/Cargo.toml
cargo build --release --locked --manifest-path cli/Cargo.toml
./cli/target/release/fontinass --version
```

测试通过本地模拟 Release 服务验证下载、校验、离线检查和真实可执行文件替换，不需要访问 GitHub。发布流程在 Linux x64、Windows x64、macOS Intel 和 Apple Silicon 上分别测试与构建，再生成校验清单。

源码定制版本执行 `update` 后会被官方二进制替换；需要保留本地修改时继续使用源码构建，并关闭启动检查。

## 许可

CLI 的 Cargo 元数据声明为 MIT；整个仓库的根 [LICENSE](../LICENSE) 为 AGPL-3.0。此说明保留既有声明，不改变授权条款。
