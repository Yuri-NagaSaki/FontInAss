
<h1 align="center">FontInAss</h1>

<p align="center">
  <strong>开源字幕字体子集化服务</strong><br>
  上传 ASS / SSA / SRT 字幕，自动匹配字体并嵌入精简子集，保留字体布局与字形信息
</p>

<p align="center">
  <a href="https://font.anibt.net">在线服务</a> ·
  <a href="https://github.com/Yuri-NagaSaki/FontInAss/releases/tag/v2.0.0">v2.0.0</a> ·
  <a href="#cli-工具">CLI 工具</a> ·
  <a href="#docker-部署">Docker 部署</a> ·
  <a href="https://t.me/anibtass">Telegram 社群</a>
</p>

---

> [!IMPORTANT]
> FontInAss v2.0.0 是一次不兼容的服务端完全重写。v1 的 `fonts.db`、upload token 和处理日志不会直接迁移；升级前请阅读[从 v1 升级](#从-v1-升级)。Rust CLI 使用的 `/api/subset` 传输协议仍是 v2 正式协议，现有调用方式无需修改。

## 简介

FontInAss 是一个开源的字幕字体子集化工具。将 ASS/SSA/SRT 字幕文件上传后，系统自动从在线字体库中匹配字幕引用的字体，提取实际使用的字符生成极小的子集化字体，并嵌入到字幕文件中。

支持 Web 界面、命令行工具（CLI）和 API 调用三种使用方式。

## 主要功能

- 提取所需字符及其布局依赖，实际压缩比例取决于字体和字幕内容
- 在线字体库，收录数万款中日韩及西文字体
- 批量处理与可控并发
- 跨平台 CLI 工具，本地批量处理
- 字幕分享，浏览和下载社区贡献的已处理字幕包
- Hono RPC + Zod 端到端 JSON 契约
- SQLite 字体目录与 R2 分享 manifest 灾备
- Docker 一键部署

## v2 架构

v2 将旧的单体路由实现重写为按能力划分的 Bun workspace：

```text
packages/
  contracts/             wire DTO、Zod schema、响应 CODE
  subtitle-processing/   ASS/SSA/SRT 解析与字体子集化
  font-catalog/          字体匹配、索引、上传与去重
  archive-library/       分享库、审核与 manifest
  access-control/        上传申请、凭证签发/验证/吊销与审计
  font-submission/       受控字体提交、限额、去重与结果归一化
  activity-log/          处理记录与缺失字体
  persistence/           SQLite adapters
  storage/               FS 与 R2 adapters
server/
  src/container.ts       唯一组合根
  src/app.ts             Hono 路由与 AppType
web/
  src/api/client.ts      Hono RPC + 文件/二进制 adapter
```

JSON 接口由共享 Zod schema 校验并通过 Hono RPC 向 Web 提供类型；字体、字幕包、流和 `/api/subset` 二进制传输使用专用 adapter。正式接口由 v1 的 43 个收敛为 40 个，不提供旧路由兼容层。

## Docker 部署

```bash
git clone git@github.com:Yuri-NagaSaki/FontInAss.git
cd FontInAss
mkdir -p fonts data
cp .env.example .env
# 编辑 .env，设置 API_KEY
docker compose up -d
```

访问 `http://localhost:3300`，进入字体管理页面点击「扫描并索引」建立字体索引。

更新现有 v2 部署：

```bash
git pull --ff-only
./rebuild-and-start.sh
```

脚本要求先提交代码，并对部署加锁。构建期间旧服务继续运行；构建完成后，将 SQLite 在线备份到 `data/backups/`，再切换容器并验证健康契约及镜像提交号。切换失败会恢复 `fontinass-local:rollback` 镜像。备份文件含权限与业务数据，应限制访问并定期按运维策略清理。

compose 将容器内存限制为 3GiB（`mem_limit` 与 `memswap_limit` 相同，不使用 swap）。超出后由内核 OOM 结束进程，`restart: unless-stopped` 会拉起新进程。

## 从 v1 升级

v2 使用全新的 `data/fontinass-v2.db`，不会改写旧 `data/fonts.db`。建议按以下顺序一次性切换：

```bash
git pull --ff-only
cp data/fonts.db data/fonts.db.v1-backup
bun install --frozen-lockfile

# 使用 R2 字幕分享库时执行；从旧 DB 导出 published 完整元数据到 R2 manifest
bun run data:manifest

# 从 ./fonts 离线建立全新的 v2 字体索引
bun run data:reindex

./rebuild-and-start.sh
```

- `data:manifest` 需要 `.env` 中的 R2 凭据；未使用分享库时跳过。
- v1 upload token、处理日志、缺失字体 resolved 状态和 rate-limit 计数不会迁移。
- 切换后请在管理界面重新签发 upload token。
- 回滚时保留旧 `fonts.db` 和旧镜像即可；R2 原有 blob 不会移动或改名。

### 配置项

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务器端口 |
| `API_KEY` | _(空)_ | 管理鉴权密钥 |
| `CORS_ORIGIN` | `*` | 允许访问 API 的前端 origin |
| `FONT_DIR` | `./fonts` | 字体存储目录 |
| `DB_PATH` | `./data/fontinass-v2.db` | v2 数据库路径 |
| `PENDING_DIR` | `./data/pending-v2` | 待审核字幕包目录 |
| `LOG_DIR` | `./data/logs` | 服务日志目录 |
| `SUBSET_CONCURRENCY` | `2` | 全局同时处理的字幕请求数；批次内依次处理，超额请求返回 503 |
| `SUBSET_MAX_FILES` | `20` | 单次批量字幕文件数上限 |
| `SUBSET_MAX_FILE_SIZE` | `8388608` | 单个字幕文件最大字节数 |
| `SUBSET_MAX_BATCH_SIZE` | `33554432` | 单次批量字幕总字节上限 |
| `CACHE_MAX_ENTRIES` | `100` | 字幕结果内存缓存条目数 |
| `CACHE_MAX_BYTES` | `67108864` | 字幕结果内存缓存字节上限 |
| `ACTIVITY_RETENTION_DAYS` | `30` | 处理日志保留天数 |
| `UPLOAD_TARGET_DIR` | `CatCat-Fonts/` | Web/API 字体投稿目标目录 |
| `PUBLIC_UPLOAD_MAX_FILES` | `20` | 公开页面单批最大文件数 |
| `PUBLIC_UPLOAD_MAX_FILE_SIZE` | `104857600` | 公开页面单个字体文件最大字节数 |
| `PUBLIC_UPLOAD_MAX_BATCH_SIZE` | `104857600` | 公开页面单批总字节上限 |
| `PUBLIC_UPLOAD_REQUESTS_PER_MINUTE` | `30` | 公开页面单 IP 每分钟请求上限 |
| `TOKEN_APPLICATION_DAILY_LIMIT` | `3` | 单 IP 每日上传权限申请上限 |
| `AUTO_INDEX_INTERVAL_HOURS` | `4` | 自动扫描、索引和去重周期 |
| `SHARING_MAX_FILE_SIZE` | `209715200` | 字幕包最大压缩文件大小 |
| `ARCHIVE_MAX_UNCOMPRESSED` | `2147483648` | 字幕包最大解压总大小 |
| `SHARING_RATE_LIMIT` | `3` | 单 IP 每日社区投稿上限 |
| `R2_*` | _(空)_ | 分享库使用的 Cloudflare R2 配置 |

完整示例见 [.env.example](.env.example)。已有 `.env` 不会自动采用新默认值，3 GiB 容器建议设置 `SUBSET_CONCURRENCY=2`、`SUBSET_MAX_FILE_SIZE=8388608`、`SUBSET_MAX_BATCH_SIZE=33554432`。生产环境务必设置强随机 `API_KEY`，并通过反向代理提供 HTTPS。

SRT 未提供自定义样式时使用 Arial 默认样式，输出为 ASS；缺少字体或字形时会报告。严格模式遇到缺字不会返回处理结果。别名包含所需字符集合，降低不同字幕轨的子集字体冲突；`preserve` 模式仍需使用者处理多轨同名字体的冲突。

## 字体上传权限

字体上传分为两条独立路径：`/upload` 是匿名公开投稿，执行文件数、单文件大小、批次大小与 IP 频率限制；字幕组通过 `/access` 申请后台凭证，管理员审核后，凭证可进入 `/fonts` 查看和下载全部已索引字体，并使用不受公开投稿策略约束的后台上传或 `POST /api/v1/upload`。

字幕组凭证不能删除字体、重建索引或管理其他凭证；这些破坏性能力只接受 `API_KEY` 管理员密钥。管理员也可直接签发字幕组凭证。吊销采用软吊销，上传历史会保留。

## CLI 工具

跨平台命令行工具，通过 FontInAss 服务处理字幕文件。

从 [GitHub Releases](https://github.com/Yuri-NagaSaki/FontInAss/releases) 下载对应平台的二进制文件：

| 平台 | 文件 |
|------|------|
| Linux x64 | `fontinass-linux-x64` |
| macOS x64 | `fontinass-macos-x64` |
| macOS ARM | `fontinass-macos-arm64` |
| Windows x64 | `fontinass-windows-x64.exe` |

```bash
# 配置服务器（仅需一次）
fontinass config set server https://font.anibt.net

# 处理单个文件
fontinass subset file.ass

# 批量处理
fontinass subset *.ass

# 递归处理目录
fontinass subset -r ./subs/

# 关闭兼容别名，保留原始字体名
fontinass subset --font-name-mode preserve --strict --clean *.ass

# 多字幕轨内封时，为不同轨道使用不同别名盐，避免 MKV 字体冲突
fontinass subset --alias-salt SC simple-jp.ass
fontinass subset --alias-salt TC traditional-jp.ass
```

CLI 默认使用 `--font-name-mode alias`；`preserve` 保留字幕引用和内嵌字体的原始家族名。`--strict` 和 `--clean` 不改变命名模式。还原已生成别名的字幕时，需要保留 `; Font Subset:` 映射注释，并使用 `--font-name-mode preserve --clean` 重新处理；服务端仍需具备对应原始字体。

详细文档见 [cli/README.md](cli/README.md)。

## 开发与验证

需要 Bun 1.4.0、Python 3（安装 FontTools 4.62.1）、HarfBuzz CLI（`hb-subset`）和 7z。Docker 镜像已包含这些依赖：

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build

# 一次执行完整检查
bun run check
```

数据脚本：

```bash
bun run data:manifest  # 从旧 DB 写入 R2 archive manifest
bun run data:reindex   # 从 FONT_DIR 重建 v2 SQLite 字体索引
```

## 审计与性能复查

完整记录见 [2026-10-04 项目审计](docs/audits/2026-10-04-project-audit.md)。

```bash
bun scripts/benchmark-subset.ts http://127.0.0.1:3300 /tmp/fontinass-benchmark
python3 scripts/verify-shaping.py /tmp/fontinass-benchmark
python3 scripts/benchmark-lookup.py data/fontinass-v2.db
```

子集化基准使用合成字幕，会产生正常处理日志；字形对比脚本需要本地生产字体库及 `hb-shape`。冷处理隔离在有 CPU、内存和时间限制的子进程中，可能比旧实现耗时更长；服务主线程可继续响应其他请求。

## API 与设计文档

- [v2 正式端点清单](docs/plans/2026-07-22-server-rewrite-endpoint-ledger.md)
- [服务端重写设计与实施记录](docs/plans/2026-07-22-server-rewrite-design.md)
- [v2.0.0 发布说明](docs/releases/v2.0.0.md)

## 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | Bun |
| 后端框架 | Hono |
| 数据库 | SQLite |
| 字体处理 | HarfBuzz + FontTools；直接读取 sfnt 名称与样式元数据 |
| 前端 | Vue 3 + Tailwind CSS v4 |
| CLI | Rust |
| 部署 | Docker |

## 许可证

[AGPL-3.0](LICENSE)
