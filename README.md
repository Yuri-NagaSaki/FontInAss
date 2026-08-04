<h1 align="center">FontInAss</h1>

<p align="center">
  <strong>开源字幕字体子集化与字幕组协作服务</strong><br>
  公开处理字幕，字幕组成员通过 AniBT OpenID Connect 管理字体与字幕归档。
</p>

<p align="center">
  <a href="https://font.anibt.net">在线服务</a> ·
  <a href="#字幕组工作区">字幕组工作区</a> ·
  <a href="#程序接口">程序接口</a> ·
  <a href="#本地开发">本地开发</a> ·
  <a href="https://t.me/anibtass">Telegram 社群</a>
</p>

> [!IMPORTANT]
> FontInAss v3 删除了旧的上传权限申请、人工审核、领取凭据和浏览器 Master Key 流程，不提供兼容路由。v2 `fia_` 凭据在 SQLite v3 迁移时全部撤销，历史上传记录会复制为只读的 redacted receipt。现有 `/api/subset` 二进制协议保持不变。

## 功能边界

无需登录即可使用：

- ASS / SSA / SRT 字幕字体匹配与子集化
- 受文件数、大小与频率限制的字体投稿
- 已公开字幕归档的浏览与下载

AniBT 字幕组成员登录后可以：

- 浏览、下载和上传字体
- 上传字幕归档并下载所属字幕组的原始归档
- 为自动化任务生成细粒度程序凭据
- 查看自己程序凭据的 redacted 活动回执

具有 AniBT `fontinass.manage` 权限的管理员还可以维护全局字体索引、R2 字体库、字幕归档、程序凭据与系统回执。权限由 AniBT 实时 entitlement 决定；FontInAss 不保存业务成员关系，也没有独立审核角色。

## 字幕组工作区

浏览器入口为 `/workspace`。登录采用标准 OIDC Authorization Code + PKCE S256，并验证 `state`、`nonce`、issuer、audience、时间声明、UserInfo subject 和 AniBT namespaced stable user ID。

FontInAss 随后向 AniBT 发起签名的 server-to-server entitlement 查询，确认账号状态、字幕组成员关系和 `fontinass.manage`。只有 entitlement 仍有效时才创建或继续使用本地 opaque Session。

安全属性：

- `__Host-fontinass_session` Secure、HttpOnly、SameSite=Lax Cookie
- Session idle/absolute expiry、Session fixation rotation、CSRF 和 recent-auth
- 私有响应与下载使用 `no-store`
- 成员失去字幕组资格、账号禁用或封禁后立即 fail closed
- Cookie、程序 Bearer 和 operator credential 不能跨 surface 使用

## 程序接口

字幕组成员可在工作区选择组织和 scope 后创建程序凭据。完整 `fia_` 值只在创建 HTTPS response 中显示一次；SQLite 只保存 prefix、suffix、generation 和 keyed fingerprint。

可用 scope：

| Scope | 能力 |
| --- | --- |
| `fonts.read` | 列出并下载字体 |
| `fonts.write` | 上传字体 |
| `subtitles.read` | 列出并下载组织字幕归档 |
| `subtitles.write` | 上传组织字幕归档 |

程序请求只接受 `Authorization: Bearer <credential>`：

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/whoami` | 返回组织与有效 scope |
| `GET` | `/api/v1/fonts` | 列出字体 |
| `GET` | `/api/v1/fonts/:id/download` | 下载字体 |
| `POST` | `/api/v1/upload` | 上传字体，multipart field 为 `file` |
| `GET` | `/api/v1/archives` | 列出组织字幕归档 |
| `POST` | `/api/v1/archives` | 上传组织字幕归档 |
| `GET` | `/api/v1/archives/:id/source` | 下载组织原始归档 |

凭据在每次请求时重新确认 AniBT 账号与字幕组成员关系；撤销、到期或失去成员关系会立即失效。不要把凭据放入 URL、日志、前端 bundle 或 Git。

## 代码结构

```text
packages/
  contracts/             wire DTO 与 Zod schema
  access-control/        OIDC entitlement adapter 与 WorkspaceAccess 状态机
  subtitle-processing/   字幕解析、字体匹配与子集化
  font-catalog/          字体索引、上传、下载与去重
  font-submission/       公开/授权上传策略与审计
  archive-library/       公开归档、组织归档与 R2 manifest
  persistence/           SQLite v3 repositories 与迁移
  storage/               文件系统与 R2 adapters
server/
  src/app.ts             Hono transport 与严格 surface middleware
  src/oidc.ts            OIDC BFF
  src/container.ts       唯一组合根
web/
  src/views/WorkspaceView.vue
  src/api/client.ts
```

`WorkspaceAccess` 负责纯授权、Session、程序凭据和回执语义；Hono functions 只做请求校验、鉴权边界、调用 service 与安全错误转换。SQLite 保存 FontInAss 本地执行数据，AniBT 保存用户、字幕组和权限事实。

## SQLite v3 迁移

服务启动时幂等执行 v3 迁移：

- 新增 OIDC identity、login transaction、Web Session、程序凭据、创建限流与 append-only access receipt
- 为字幕归档增加组织 ownership 和 redacted uploader attribution
- 保留旧 `api_tokens` / `api_upload_history` 作为迁移历史，但不再提供运行时 service 或 HTTP API
- 自动撤销所有旧凭据，并把历史复制到 `font_upload_receipts`

数据库文件名仍默认为 `data/fontinass-v2.db`，以便原地迁移现有部署；文件名不代表 schema 版本。

历史字幕归档可以使用仓库外映射文件进行 deterministic 归属：

```bash
# 默认 dry-run，只输出数量和 keyed fingerprint
bun run data:archive-ownership --mapping=/private/archive-ownership.json

# 人工确认统计后再应用；歧义和未匹配记录保持 administrator-only
bun run data:archive-ownership --mapping=/private/archive-ownership.json --apply
```

映射文件和 fingerprint secret 不得提交到仓库。

## 配置

复制 [.env.example](.env.example) 后，仅填入本地开发值。生产值必须由部署平台的 secret/config store 注入。

主要配置组：

| 变量 | 说明 |
| --- | --- |
| `FONTINASS_PUBLIC_ORIGIN` | FontInAss HTTPS public origin |
| `FONTINASS_OPERATOR_CREDENTIAL` | 独立 machine-only operator credential |
| `FONTINASS_OIDC_*` | AniBT issuer、Client ID、Client secret、callback、logout 与 scope |
| `FONTINASS_ENTITLEMENT_*` | AniBT entitlement HMAC identity 与 signing secret |
| `FONTINASS_SESSION_*` | 独立 Session fingerprint/encryption keys 与时限 |
| `FONTINASS_CREDENTIALS_PER_*` | 用户/组织 active credential quota |
| `FONTINASS_CREDENTIAL_CREATIONS_PER_HOUR` | 持久创建限流 |
| `FONT_DIR` / `DB_PATH` / `PENDING_DIR` | 字体、SQLite 与社区投稿暂存路径 |
| `R2_*` | 字幕归档使用的 Cloudflare R2 配置 |

OIDC confidential Client、entitlement signing、Session protection 和 operator 必须使用四类独立 credential。生产启动在缺失所需值时 fail closed。

## 容器运行

```bash
git clone git@github.com:Yuri-NagaSaki/FontInAss.git
cd FontInAss
mkdir -p fonts data
cp .env.example .env
# 填写本地开发配置；不要把 .env 提交到 Git
docker compose up -d
```

默认只绑定 `127.0.0.1:3300`。生产必须放在 HTTPS reverse proxy 后，不要直接公开容器端口。健康契约为：

```json
{ "status": "ok", "version": 3 }
```

## CLI 工具

CLI 的字幕处理路径仍使用公开 `/api/subset`，只需配置服务器地址：

```bash
fontinass config set server https://font.anibt.net
fontinass subset file.ass
fontinass subset *.ass
fontinass subset -r ./subs/
```

详细说明见 [cli/README.md](cli/README.md)。程序化字体/字幕组归档操作请使用上面的 scoped Bearer API。

## 本地开发

需要 Bun 1.3.14：

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun run check
```

## 设计文档

- [AniBT OIDC 工作区与安全边界](docs/oidc-workspace.md)
- [v2 服务端重写端点清单](docs/plans/2026-07-22-server-rewrite-endpoint-ledger.md)
- [v2.0.0 发布说明](docs/releases/v2.0.0.md)

## 许可证

[AGPL-3.0](LICENSE)
