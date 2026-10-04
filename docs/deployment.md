# 自部署、配置与恢复

本文面向使用自己的字体库运行 FontInAss 的管理员。Docker 部署推荐 Linux 主机，需要 Git、Docker Engine、Compose v2；部署脚本还使用 Bash 和 `flock`。Docker 镜像包含 Bun 1.4.2、Python、FontTools 4.62.1、HarfBuzz 与 7z。

## 首次启动

```bash
git clone https://github.com/Yuri-NagaSaki/FontInAss.git
cd FontInAss
mkdir -p fonts data
cp .env.example .env
```

编辑 `.env`，设置强随机 `API_KEY`，然后将 `.ttf`、`.otf`、`.ttc`、`.otc` 字体复制到 `fonts/`。字体可按子目录组织，字体和数据库均不会写入 Git。首次部署不自带在线站点的字体库。

```bash
./rebuild-and-start.sh
curl -fsS http://127.0.0.1:3300/api/health
```

预期健康响应为 `{"status":"ok","version":2}`。打开 `http://localhost:3300`，进入字体管理页面，填写管理员密钥并执行扫描索引。服务端只会匹配已索引的字体；自动维护默认每 4 小时扫描并去重，首批使用前应手动扫描。

不具备 Bash/`flock` 的 Docker Desktop 环境可用 `docker compose up -d --build` 启动，但该命令不包含部署脚本的在线备份与自动回滚。

## 持久化与网络

| 主机目录 | 容器位置 | 内容 |
| --- | --- | --- |
| `./fonts` | `/app/fonts` | 本地字体文件 |
| `./data` | `/app/data` | SQLite、日志、待审核包、部署备份 |

Compose 默认监听 `127.0.0.1:3300`，容器内端口为 3000。对公网提供服务时使用 HTTPS 反向代理，并设置 `CORS_ORIGIN`。应由入口代理覆盖客户端 IP 头，服务中的投稿限流依赖这些头。

`API_KEY` 为空时，管理接口无需鉴权。应在首次启动前配置，不要把示例值用于公开部署。R2 凭据和 API key 均应保留在 `.env`，不要提交或分享该文件。

## 配置参考

以下是源码运行的默认值；Compose 将路径改为上述容器目录。已有 `.env` 会覆盖默认值，升级后不会自动改写。

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
完整配置示例见 [根目录 .env.example](../.env.example) 和 [server/.env.example](../server/.env.example)。源码还支持 `CACHE_TTL_MS`，默认 48 小时；Compose 需要显式添加该环境变量才会透传。

`SUBSET_CONCURRENCY` 是全局同时处理请求数，单个批次内部依次处理。超出并发数时返回 HTTP 503 和 `Retry-After`。默认每个字幕 8 MiB、每批 32 MiB，过大请求会被拒绝。字体上传与字幕处理有不同限额，受信任成员上传仍受 HTTP 请求体上限限制。

容器限制为 3 GiB 内存、禁用 swap、128 个 PID，并启用日志轮转。原生字体进程另有内存、CPU、超时和生成数据上限，空闲或处理一定数量任务后回收。改变并发前应按实际字体负载测量内存和吞吐量。

## 字体投稿与权限

| 身份 | 能力 |
| --- | --- |
| 匿名用户 | 处理字幕、公开字体投稿、提交待审核字幕包；受相应限流和大小限制 |
| 已批准字幕组凭证 | 查看、下载字体，后台或程序上传；不能删除、重建索引或管理凭证 |
| 管理员 `API_KEY` | 字体删除、扫描、去重、凭证管理和分享审核 |

公开字体投稿入口为 `/upload`。字幕组通过 `/access` 申请凭证，管理员也可直接签发。字体文件应具有可用许可；上传不会替代字体授权。

## 可选的 R2 分享库

配置 `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY` 和 `R2_BUCKET_NAME` 后可发布字幕包。`R2_PUBLIC_URL` 用于生成公开下载地址，需要与桶的公共访问配置匹配。

待审核包位于本机 `data/pending-v2/`，发布包位于 R2。系统会写入分享 manifest；数据库为空且 R2 已配置时尝试恢复。manifest 只覆盖已发布分享元数据，不替代字体文件、凭证、处理日志和待审核文件的备份。

## 更新与回滚

```bash
git pull --ff-only
./rebuild-and-start.sh
```

脚本要求跟踪文件没有未提交修改。它依次执行：

1. 获取部署互斥锁，构建以当前 Git 提交号标记的镜像；旧容器继续服务。
2. 使用 SQLite `VACUUM INTO` 在线备份已提交的数据，包括 WAL 中的提交。备份保存为 `data/backups/fontinass-时间戳.db`，权限为 0600。
3. 将旧镜像保留为 `fontinass-local:rollback`，切换到新容器。
4. 核对健康接口、镜像 revision 和 `.bun-version`；失败时恢复旧镜像。

部署后检查实际运行结果：

```bash
docker exec fontinass-local bun --version
docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' fontinass-local
curl -fsS http://127.0.0.1:3300/api/health
docker compose logs --tail=50
```

还应提交一个已知字体的字幕，确认生成了 `[Fonts]`，并检查公网域名。健康响应不覆盖字体布局正确性或 R2 权限。

手动恢复上一镜像：

```bash
FONTINASS_IMAGE_TAG=rollback docker compose up -d --no-build --force-recreate
```

旧镜像只保留最近一次脚本记录的版本。数据库恢复需先停止写入服务，再按备份状态恢复数据库及相关文件；不要在服务写入时覆盖 DB/WAL 文件。未来不兼容的 schema 变更可能要求同时恢复数据库，不能仅靠镜像回滚。

`data/backups/` 不自动删除旧备份，应定期复制到其他位置并按保留策略清理。它含有权限和业务数据；字体目录和 R2 对象需要单独备份。

## 从 v1 迁移

v2 使用 `data/fontinass-v2.db`，不会覆盖旧 `data/fonts.db`。v1 的上传凭证、处理日志、缺失字体已解决状态和限流计数不直接迁移。

1. 保留旧镜像，并通过 SQLite 在线备份或停止写入后的复制保存旧数据库。
2. 将配置和字体目录准备好，安装 Bun 1.4.2 及下文原生依赖。
3. 使用 R2 分享库时，导出旧库已发布记录到 manifest；未使用则跳过。
4. 从本地字体目录建立 v2 索引后再切换服务。

```bash
bun install --frozen-lockfile
bun run data:manifest    # 使用 R2 时执行，需要 R2_* 配置
bun run data:reindex
./rebuild-and-start.sh
```

切换后重新签发成员凭证，检查原有分享、字体匹配和新请求。R2 原有对象不会因迁移自动改名。

## 源码运行与开发

推荐使用项目指定的 Bun 版本：

```bash
bun --version            # 应与 .bun-version 一致
bun install --frozen-lockfile
```

Linux 可安装 HarfBuzz、Python venv 和 7z，然后建立 FontTools 环境：

```bash
sudo apt-get install libharfbuzz-bin python3-venv p7zip-full
python3 -m venv .venv
. .venv/bin/activate
pip install fonttools==4.62.1
```

服务启动会检查 `python3` 能导入 FontTools，并能执行 `hb-subset`。原生字体进程使用 POSIX 资源限制；Windows 开发服务端应通过 Docker 或 WSL。Rust CLI 可直接在 Windows 上构建和运行。

所有路径相对于进程工作目录解析。开发时可从仓库根目录直接运行服务端，使根 `.env` 的 `./fonts`、`./data` 与 Docker 的主机目录一致：

```bash
# 终端一，从仓库根运行
bun --hot server/src/index.ts

# 终端二，启动 Web 开发服务器
bun run --cwd web dev
```

Web 开发代理默认访问 `http://localhost:3000`，可用 `VITE_API_BASE_URL` 覆盖。若用 `bun run dev` 或 `bun run start`，服务端工作目录是 `server/`，应在 `server/.env` 中使用正确的路径，建议设为字体和数据目录的绝对路径。

```bash
bun run check
cargo test --locked --manifest-path cli/Cargo.toml
```

性能和持续处理测试需要独立数据库快照，避免给生产日志写入压测记录。详细命令见 [性能报告](performance/2026-10-04-bun-1.4.2.md)。
