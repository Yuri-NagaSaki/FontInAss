# AniBT 字幕工坊

AniBT 社区的字幕与字体工作区，由 FontInAss 开源引擎提供处理能力。字幕制作者与动画爱好者可以在这里处理字幕、补充共享字体、分享制作成果，并交流使用问题。

[打开字幕工坊](https://font.anibt.net/) · [使用指南](https://font.anibt.net/about) · [AniBT 社区](https://anibt.net/) · [社区文档](https://wiki.anibt.net/) · [加入社群](https://t.me/anibtass)

## 在社区中使用

| 需要做什么 | 入口 | 使用方式 |
| --- | --- | --- |
| 匹配、精简并嵌入字幕字体 | [字幕处理](https://font.anibt.net/subset) | 选择 ASS、SSA、SRT 文件，检查处理结果后下载 |
| 下载或分享字幕包 | [社区字幕库](https://font.anibt.net/sharing) | 公开浏览与下载；投稿经审核后发布 |
| 补充缺失字体 | [补充字体](https://font.anibt.net/upload) | 无需凭证；支持 TTF、OTF、TTC、OTC，验证与去重后入库 |
| 维护字幕组字体 | [字幕组工作区](https://font.anibt.net/access) | 申请权限，保存回执，审核通过后领取凭证 |
| 反馈缺字或处理问题 | [社区交流](https://font.anibt.net/comments) | 提供操作步骤、字体名称与错误提示 |
| 接入本地制作流程 | [命令行指南](https://font.anibt.net/cli) | 使用 FontInAss CLI 或 API |

工坊与 [AniBT 动画及资源服务](https://anibt.net/)、[社区文档](https://wiki.anibt.net/)和 [Tracker](https://tracker.anibt.net/)使用统一的社区入口与视觉风格。FontInAss 保留为开源引擎和命令行客户端名称，仓库地址、`fontinass` 命令及 API 路径不变。工坊凭证与 AniBT 主站登录分别管理。

## 处理第一份字幕

1. 保留原始字幕，进入「字幕处理」。
2. 选择或拖入 ASS、SSA、SRT 文件。SRT 会转换为 ASS 后处理。
3. 按需打开「处理设置」，调整严格模式、字体别名、清除内嵌字体和下载时提取字体等选项。
4. 等待系统从字体库匹配字体，提取字幕实际使用的字形并嵌入结果。
5. 展开警告检查缺少的字体或字形，再下载字幕并在目标播放器中确认效果。

子集化减少需要嵌入的字体数据，缩减幅度取决于原字体和字幕用字。文件数、单文件大小及批次大小受服务配置限制。部分播放器对 ASS 内嵌字体的支持有限，可在下载时提取字体用于单独加载或封装。

出现缺失字体时，可将有权分享的字体提交到共享库后重试，也可在社区交流区提供字体名称与错误提示。严格模式遇到缺失字体时不输出结果。

## 参与社区共建

- **补充字体**：仅提交有权分享的文件。公开上传受文件数、大小和 IP 请求频率限制，以页面显示为准。
- **分享字幕**：在字幕库提交 ZIP 或 7z 字幕包，填写番剧、字幕组与语言信息，保留作者署名。管理员审核通过后公开发布。
- **反馈问题**：说明复现步骤与实际结果。请勿公开密钥、申请回执或私人信息。

处理字幕不会自动将文件发布到字幕库。公开分享需要主动投稿并通过审核。

## 运行与维护

以下内容适用于自托管维护者。线上使用无需自行部署或建立字体索引。

> FontInAss v2 是一次不兼容的服务端重写。v1 的 `fonts.db`、上传凭证和处理日志不会直接迁移；升级前请阅读[从 v1 升级](#从-v1-升级)。Rust CLI 使用的 `/api/subset` 传输协议仍是 v2 正式协议，现有调用方式不变。

### v2 架构

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

脚本会先完成镜像构建，再 recreate 容器，并等待 `{ "status": "ok", "version": 2 }` 健康契约，避免构建期间停机。

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
| `SUBSET_CONCURRENCY` | `5` | 批量字幕并行处理数 |
| `SUBSET_MAX_FILES` | `20` | 单次批量字幕文件数上限 |
| `SUBSET_MAX_FILE_SIZE` | `67108864` | 单个字幕文件最大字节数 |
| `SUBSET_MAX_BATCH_SIZE` | `268435456` | 单次批量字幕总字节上限 |
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

完整示例见 [.env.example](.env.example)。生产环境务必设置强随机 `API_KEY`，并通过反向代理提供 HTTPS。

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

# 多字幕轨内封时，为不同轨道使用不同别名盐，避免 MKV 字体冲突
fontinass subset --alias-salt SC simple-jp.ass
fontinass subset --alias-salt TC traditional-jp.ass
```

详细文档见 [cli/README.md](cli/README.md)。

## 开发与验证

需要 Bun 1.4.0：

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build

# 一次执行完整检查
bun run check
```

浏览器回归（对运行中的 Docker 服务执行，只读检查，不提交字体或评论）：

```bash
bunx --cwd web playwright install chromium
UI_BASE_URL=http://127.0.0.1:3300 bun run --cwd web test:ui
```

检查覆盖全部 10 个页面、320–1440px 布局、明暗主题、中英文、移动导航、设置弹窗、SRT 选择器与指南问答。截图和报告默认写入 `/tmp/fontinass-community-ui`，可用 `UI_ARTIFACT_DIR` 修改。

数据脚本：

```bash
bun run data:manifest  # 从旧 DB 写入 R2 archive manifest
bun run data:reindex   # 从 FONT_DIR 重建 v2 SQLite 字体索引
```

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
| 字体处理 | opentype.js |
| 前端 | Vue 3 + Tailwind CSS v4 |
| CLI | Rust |
| 部署 | Docker |

## 许可证

[AGPL-3.0](LICENSE)
