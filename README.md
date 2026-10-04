# FontInAss

FontInAss 将字幕使用的字体提取为子集，嵌入 ASS 字幕的 `[Fonts]` 节。它支持 ASS、SSA、SRT 输入，通过 Web、CLI 或 API 使用，适合字幕制作、批量处理和自建字体服务。

[在线服务](https://font.anibt.net) · [CLI 下载](https://github.com/Yuri-NagaSaki/FontInAss/releases/latest) · [问题反馈](https://github.com/Yuri-NagaSaki/FontInAss/issues) · [Telegram 社群](https://t.me/anibtass)

## 选择使用方式

| 需要做什么 | 入口 |
| --- | --- |
| 直接处理几个字幕 | [在线字幕处理](https://font.anibt.net/subset) |
| 处理目录或接入脚本 | [CLI 使用与更新](cli/README.md) |
| 使用自己的字体库和服务器 | [自部署指南](docs/deployment.md) |
| 在其他程序中调用 | [API 接入说明](docs/api.md) |
| 修改代码或复查性能 | [开发与验证](#开发与验证)、[性能报告](docs/performance/2026-10-04-bun-1.4.2.md) |

CLI 是服务端的客户端：它把字幕发送给配置的 FontInAss 服务，由服务器匹配字体并生成结果。运行 CLI 不需要 Bun、Python 或本机字体库；离线处理需要在本机部署完整服务。

## 能做什么

- 根据 ASS/SSA 样式、字体覆盖标签、字重、斜体和可见字符收集字体需求，区分绘图与文字。
- 使用 HarfBuzz 生成字体子集，并保留所需布局依赖、字形轮廓、竖排信息及连字；FontTools 维护字体名称。
- 报告缺失字体和缺失字形；严格模式在存在这些问题时不输出处理结果。
- 选择兼容别名或保留原字体名，支持已有子集字幕的清理和重新处理。
- 管理本地字体库：扫描、匹配、上传、去重；区分匿名投稿、字幕组凭证与管理员权限。
- 通过可选的 Cloudflare R2 存储发布和分享字幕包，支持投稿审核与 manifest 恢复。

SRT 会转换为 ASS；未提供自定义样式时使用 Arial，服务器需要有对应字体。字体体积减少程度取决于源字体、使用字符和布局依赖，不保证固定压缩比例。

## 在线处理

1. 打开 [字幕处理页面](https://font.anibt.net/subset)，选择或拖入 `.ass`、`.ssa`、`.srt` 文件。
2. 在设置中选择严格模式、字体命名方式；已有内嵌字体的字幕需启用清理后重新处理。
3. 查看缺失字体或字形提示，处理完成后下载单个字幕或批量 ZIP。

字幕和文件名会发送到所选服务器。服务记录处理文件名、状态、缺失字体和耗时；需要控制数据范围时，可使用本地部署。

## CLI 快速开始

当前 CLI 版本为 **[v2.2.0](https://github.com/Yuri-NagaSaki/FontInAss/releases/tag/cli-v2.2.0)**，与服务端 v2 协议兼容。

| 平台 | 下载文件 |
| --- | --- |
| Linux x64 | [fontinass-linux-x64](https://github.com/Yuri-NagaSaki/FontInAss/releases/latest/download/fontinass-linux-x64) |
| macOS Intel | [fontinass-macos-x64](https://github.com/Yuri-NagaSaki/FontInAss/releases/latest/download/fontinass-macos-x64) |
| macOS Apple Silicon | [fontinass-macos-arm64](https://github.com/Yuri-NagaSaki/FontInAss/releases/latest/download/fontinass-macos-arm64) |
| Windows x64 | [fontinass-windows-x64.exe](https://github.com/Yuri-NagaSaki/FontInAss/releases/latest/download/fontinass-windows-x64.exe) |

下载后将程序改名为 `fontinass`（Windows 为 `fontinass.exe`）并放入 `PATH`。Linux/macOS 需要 `chmod +x fontinass`。Release 附带 `SHA256SUMS` 和 `BUILD-INFO.json` 供校验。

```bash
fontinass --version
fontinass config set server https://font.anibt.net

# 将结果写入独立目录，保留原文件
fontinass subset --strict -o ./output/ *.ass

# 递归处理目录
fontinass subset --strict -r -o ./output/ ./subs/

# 保留原始字体名
fontinass subset --font-name-mode preserve --strict -o ./output/ *.ass

# 清理已有字体并重新处理
fontinass subset --clean --font-name-mode preserve --strict -o ./output/ *.ass
```

不指定 `-o` 时，ASS/SSA 成功结果会替换原文件。SRT 结果写为同名 `.ass`，原 `.srt` 保留。输出到单个目录时，同名文件或其他输出路径冲突会在请求前报错。

### 检查与安装更新

```bash
fontinass update --check       # 查询最新稳定 CLI 版本
fontinass update               # 校验并安装到当前程序位置
fontinass config set update-check false   # 关闭启动检查
```

v2.2.0 起，交互式命令启动时在后台检查更新，命令结束时提示。检查结果缓存 24 小时，网络预算为 1.2 秒；断网和 GitHub 限流不改变字幕处理结果。CI、非交互输出、`--help`、`--version` 不执行自动检查。可用 `--no-update-check` 或 `FONTINASS_NO_UPDATE_CHECK=1` 临时关闭。

启动检查只提示，不自动安装。`update` 从本仓库的稳定 `cli-v*` Release 下载当前平台文件，校验大小、SHA-256 和可执行版本后替换程序。安装目录必须可写；没有权限时会报错，不自动提权。

**v2.1.0 及更早版本没有 `update` 命令，需要先手动替换为 v2.2.0。** 完整参数、配置路径、退出码和更新限制见 [CLI README](cli/README.md)。

### 字体命名

CLI 默认 `--font-name-mode alias`；Web 的默认设置保留原字体名。

| 模式 | 行为 | 适用情况 |
| --- | --- | --- |
| `alias` | 改写字幕字体引用及内嵌家族名，别名纳入字符集合 | 减少多轨字幕中同名子集字体冲突 |
| `preserve` | 保留字幕引用的原始家族名 | 后续需要按原名查找字体的工具链 |

`--strict` 和 `--clean` 不选择命名模式。从已生成别名的字幕恢复原名，需要保留 `; Font Subset: ALIAS - OriginalFontName` 注释，使用 `--font-name-mode preserve --clean`，且服务器仍能找到原始字体。多轨 MKV 可为各轨设置不同的 `--alias-salt SC`、`--alias-salt TC`；保名模式仍需处理同名字体冲突。

## 本地部署

推荐 Linux，需 Git、Docker Engine、Compose v2、Bash、`flock` 和可用字体文件。镜像包含 Bun 1.4.2、HarfBuzz、FontTools 和 7z。

```bash
git clone https://github.com/Yuri-NagaSaki/FontInAss.git
cd FontInAss
mkdir -p fonts data
cp .env.example .env
# 编辑 .env，设置强随机 API_KEY；将字体放入 fonts/
./rebuild-and-start.sh
```

访问 `http://localhost:3300`，在字体管理页面输入管理员密钥并扫描索引。新部署不附带字体库，仓库中的 `fonts/` 和 `data/` 是本机持久化目录。

默认只绑定 `127.0.0.1:3300`，容器内存上限为 3 GiB。公开访问需配置 HTTPS 反向代理和 `CORS_ORIGIN`；`API_KEY` 为空会开放管理接口，应在首次启动前设置。

```bash
# 更新现有部署
git pull --ff-only
./rebuild-and-start.sh

# 检查运行状态
curl -fsS http://127.0.0.1:3300/api/health
docker compose logs --tail=50
```

部署脚本先构建，再在线备份 SQLite、切换容器，最后核对健康响应、提交号和 Bun 版本；失败时恢复旧镜像。数据备份、配置项、R2、回滚及 v1 迁移见 [自部署指南](docs/deployment.md)。

## API

`POST /api/subset` 提供公共字幕处理。单文件返回二进制字幕及 `X-Code`/`X-Message`，多文件返回 JSON/base64；HTTP 200 本身不等于处理成功。

```bash
curl -sS -D response.headers \
  -H 'Content-Type: application/octet-stream' \
  -H 'X-Fonts-Check: 1' \
  --data-binary @input.ass \
  https://font.anibt.net/api/subset -o output.ass
```

读取响应头中的 `X-Code`：`200` 为成功，`201` 为带警告结果，`300` 为严格模式的缺失字体或字形，`400` 为输入错误，`500` 为服务错误。业务错误可能通过 HTTP 200 返回；服务繁忙时返回 HTTP 503 和 `Retry-After`。完整接入示例见 [API 文档](docs/api.md)。

## 开发与验证

| 部分 | 工具 |
| --- | --- |
| 服务端 | Bun 1.4.2、Hono、SQLite |
| 字体处理 | HarfBuzz CLI、Python 3 + FontTools 4.62.1 |
| Web | Vue 3、Vite、Tailwind CSS |
| CLI | Rust stable，edition 2024；使用 `File::try_lock`，最低 Rust 1.89 |
| 归档检查 | 7z |

```bash
bun install --frozen-lockfile
bun run check                  # 类型检查、测试、Web 与服务端构建
cargo test --locked --manifest-path cli/Cargo.toml
cargo build --release --locked --manifest-path cli/Cargo.toml

# 开发环境；路径配置见 docs/deployment.md
bun run dev
```

源码直接运行的路径相对于启动工作目录；开发配置和原生依赖安装见 [自部署指南](docs/deployment.md#源码运行与开发)。CLI 配置与服务端 `.env` 相互独立。

```text
cli/                      Rust 客户端、版本检查与自更新
web/                      Vue 页面与 API 客户端
server/                   HTTP 路由、配置、生命周期、依赖组装
packages/
  subtitle-processing/    字幕分析、原生字体进程池、UUEncode
  font-catalog/           字体匹配、索引、投稿去重
  archive-library/        字幕包检查、审核、分享
  access-control/         凭证、申请、权限与限流
  font-submission/        投稿策略与记录
  activity-log/           处理记录与缺失字体统计
  persistence/           SQLite 存取
  storage/               本地文件与 R2
  contracts/             Zod 契约、DTO 与状态码
scripts/                  性能基线、字形对比与持续处理验证
```

## 性能与兼容性

本机三轮基线中，结果缓存未命中的字幕处理中位数从约 210 ms 降至 12.45 ms，双并发吞吐量从 8.68 提升到 82.53 文件/秒。该结果针对已预热工作进程和指定字体库；首个请求仍包含初始化开销，不是生产容量承诺。

原生进程池受并发、内存、CPU、超时和输出量限制；每 64 个字体任务或空闲 30 秒后回收。全部测量条件、未改善指标、原始数据和复测脚本见 [性能报告](docs/performance/2026-10-04-bun-1.4.2.md)。

- 支持 TTF、OTF、TTC、OTC 字体索引；实际字体覆盖由服务器库决定。
- 不保证所有播放器、字体布局特性和 ASS 方言一致。重要发布应在目标播放器中复查。
- 无 BOM 的旧编码可能有歧义，建议字幕使用 UTF-8。
- 服务端 v2 不直接迁移 v1 的凭证和日志，升级前阅读 [迁移步骤](docs/deployment.md#从-v1-迁移)。

## 文档与许可

- [CLI 参考](cli/README.md) · [部署与配置](docs/deployment.md) · [API 接入](docs/api.md)
- [CLI v2.2.0 发布说明](docs/releases/cli-v2.2.0.md)
- [项目审计](docs/audits/2026-10-04-project-audit.md) · [Bun 升级与性能基线](docs/performance/2026-10-04-bun-1.4.2.md)
- [端点清单](docs/plans/2026-07-22-server-rewrite-endpoint-ledger.md) · [v2 架构设计](docs/plans/2026-07-22-server-rewrite-design.md)

仓库根许可证为 [AGPL-3.0](LICENSE)；CLI 的 Cargo 元数据保留其既有 MIT 声明。字体文件不随源码分发，使用和分发字体应遵循各自许可证。
