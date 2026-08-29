# FontInAss v2 端点清单

日期：2026-07-22
状态：已实施并完成生产验证
正式端点：40 个（旧服务 43 个，删除 3 个遗留端点）

## 删除的旧端点

| 旧端点 | 处理 | 原因 |
| --- | --- | --- |
| `POST /api/sharing/import-index` | 删除 | 删除 AnimeSub 外部仓库同步 |
| `POST /api/fonts/repair-keys` | 删除 | v2 从字体文件重建，不保留旧 key 迁移逻辑 |
| `POST /api/sharing/upload-to-existing` | 合并到 `POST /api/archives/upload` | 上传元数据本身已经指定目标目录，独立端点是重复接口 |

## 系统

| 方法 | 路径 | 认证 | 返回 |
| --- | --- | --- | --- |
| GET | `/api/health` | None | `{ status, version: 2 }` |

## 字体目录

| 方法 | 路径 | 认证 | 用途 |
| --- | --- | --- | --- |
| GET | `/api/fonts/` | Member credential / Master key | 分页查询字体 |
| POST | `/api/fonts/` | Member credential / Master key | 字幕组或管理员后台上传字体，不套用公开投稿限制 |
| DELETE | `/api/fonts/` | Master key | 批量删除字体 |
| GET | `/api/fonts/stats` | Master key | 索引统计 |
| GET | `/api/fonts/browse` | Master key | 浏览本地字体目录 |
| GET | `/api/fonts/keys` | Master key | 递归列出字体 key |
| POST | `/api/fonts/index` | Master key | 索引指定目录或 key |
| POST | `/api/fonts/scan` | Master key | 全量重扫并清理孤儿索引 |
| GET | `/api/fonts/duplicates` | Master key | 查询重复字体 |
| POST | `/api/fonts/deduplicate` | Master key | 删除重复字体 |
| GET | `/api/fonts/:id/download` | Member credential / Master key | 下载字体 |
| DELETE | `/api/fonts/:id` | Master key | 删除单个字体 |

## 字幕处理

| 方法 | 路径 | 认证 | 传输 |
| --- | --- | --- | --- |
| POST | `/api/subset` | 公共 | 单文件二进制请求/响应；批量 multipart 请求、JSON/base64 响应 |

该 wire protocol 是 v2 正式协议，不是旧 API 兼容层；Web 与 Rust CLI 都消费同一协议。

## 字幕分享库

| 方法 | 路径 | 认证 | 用途 |
| --- | --- | --- | --- |
| GET | `/api/archives/` | 公共 | 已发布字幕包列表 |
| GET | `/api/archives/:id/download` | 公共 | 重定向到 R2 公网地址 |
| POST | `/api/archives/contribute` | 公共、按 IP 限流 | 社区投稿 |
| GET | `/api/archives/pending` | Master key | 待审核列表 |
| POST | `/api/archives/upload` | Master key | 直接发布 |
| POST | `/api/archives/:id/approve` | Master key | 审核通过 |
| POST | `/api/archives/:id/reject` | Master key | 驳回 |
| PUT | `/api/archives/:id` | Master key | 修改元数据；目录字段变化时同步移动 R2 对象 |
| DELETE | `/api/archives/:id` | Master key | 删除元数据与 blob |
| GET | `/api/archives/:id/preview` | Master key | 预览包内文件 |
| GET | `/api/archives/:id/file` | Master key | 下载包文件 |

## 活动记录

| 方法 | 路径 | 认证 | 用途 |
| --- | --- | --- | --- |
| GET | `/api/activity/` | 公共 | 处理记录分页查询 |
| GET | `/api/activity/missing-fonts` | 公共 | 缺失字体排行 |
| GET | `/api/activity/stats` | 公共 | 处理统计 |
| POST | `/api/activity/missing-fonts/resolve` | Master key | 标记已解决 |
| POST | `/api/activity/missing-fonts/unresolve` | Master key | 取消已解决 |

## 字幕组凭证

| 方法 | 路径 | 认证 | 用途 |
| --- | --- | --- | --- |
| GET | `/api/tokens/` | Master key | 字幕组凭证列表 |
| POST | `/api/tokens/` | Master key | 签发字幕组凭证 |
| GET | `/api/tokens/stats` | Master key | 凭证统计 |
| GET | `/api/tokens/history` | Master key | 全部上传历史 |
| GET | `/api/tokens/applications` | Master key | 上传权限申请列表 |
| POST | `/api/tokens/applications/:id/review` | Master key | 批准或驳回申请 |
| PATCH | `/api/tokens/:id` | Master key | 修改凭证 |
| DELETE | `/api/tokens/:id` | Master key | 软吊销凭证，保留审计历史 |
| GET | `/api/tokens/:id/history` | Master key | 单凭证上传历史 |

## 字幕组访问申请与两类字体上传

| 方法 | 路径 | 认证 | 用途 |
| --- | --- | --- | --- |
| GET | `/api/access/whoami` | Member credential / Master key | 验证后台身份并返回角色 |
| POST | `/api/token-applications` | 公共、按 IP 限流 | 创建字幕组后台权限申请并返回一次性申请凭证 |
| GET | `/api/token-applications/:id` | Application secret | 查询自己的申请状态 |
| POST | `/api/token-applications/:id/claim` | Application secret | 领取已批准的字幕组凭证 |
| GET | `/api/upload/policy` | 公共 | 读取公开投稿文件数、大小与速率限制 |
| POST | `/api/upload` | 公共、按 IP 限流 | 匿名公开字体投稿，执行公开限制 |
| POST | `/api/v1/upload` | Member credential | 字幕组程序化上传，不套用公开投稿限制 |
| GET | `/api/v1/whoami` | Member credential | 验证凭证与读取精确计数 |
| GET | `/api/v1/history` | Member credential | 读取自己的上传历史 |

公开 `/upload` 与字幕组 `/fonts`/`/api/v1/upload` 是两条独立路径。字幕组凭证不能调用删除、索引维护、分享审核或凭证管理端点。

## 客户端约束

JSON 请求由 Zod validator 在 Hono 入口校验，并通过 `AppType`/`hono/client` 提供 Web RPC 类型。文件、流、重定向与二进制响应使用小型手写 adapter，因为这些传输不适合伪装成 JSON RPC。
