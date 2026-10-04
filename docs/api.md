# API 接入

FontInAss Web 和 CLI 使用同一套 v2 接口。字幕处理为公共接口，管理与字体浏览接口的权限不同；完整端点列表见 [端点清单](plans/2026-07-22-server-rewrite-endpoint-ledger.md)。

## 健康检查

```http
GET /api/health
```

健康时返回 HTTP 200：

```json
{"status":"ok","version":2}
```

其中 `version` 表示服务契约版本，不是 Bun 或 CLI 的发布版本。

## 处理单个字幕

```http
POST /api/subset
Content-Type: application/octet-stream
```

请求体为字幕原始字节，支持 ASS、SSA、SRT。单文件 multipart 的 `file` 字段也返回相同的二进制响应。SRT 会转为 ASS；返回内容统一为 UTF-8。

| 请求头 | 值与默认行为 |
| --- | --- |
| `X-Filename` | UTF-8 文件名的 base64；省略时记录为 `subtitle.ass` |
| `X-Fonts-Check` | `1` 启用严格模式，默认关闭 |
| `X-Clear-Fonts` | `1` 清理已有 `[Fonts]` 后重做，默认关闭 |
| `X-Font-Name-Mode` | `alias` 或 `preserve`，默认 `alias` |
| `X-Font-Alias-Salt` | UTF-8 别名盐的 base64，最多 80 个字符 |
| `X-Srt-Format` | 完整 SRT 转换目标 `Format:` 行的 base64 |
| `X-Srt-Style` | 完整 SRT 转换目标 `Style:` 行的 base64，与 Format 同时提供 |

未提供 SRT 自定义样式时使用 Arial 默认样式；仅提供 Format 或 Style 其中之一会返回输入错误。

### 响应

响应体为处理结果，业务状态在 `X-Code` 中。`X-Message` 为「UTF-8 JSON 字符串数组」的 base64。

| X-Code | 含义 | 结果数据 |
| --- | --- | --- |
| `200` | 成功 | 二进制字幕 |
| `201` | 已生成，存在缺失字体、字形或其他警告 | 二进制字幕，需查看消息 |
| `300` | 严格模式未通过字体或字形检查 | 空 |
| `400` | 文件、格式、限额等输入错误 | 空 |
| `500` | 服务端处理错误 | 空 |

部分业务错误通过 HTTP 200 返回，必须检查 `X-Code`。非法表单/参数可返回 HTTP 400，请求体过大可返回 HTTP 413，并发已满返回 HTTP 503 和 `Retry-After`；这些响应可能是 JSON，不应写成字幕。超长错误消息会截断到响应头预算，完整处理消息可在活动记录中查看。

以下 Bun 示例先验证状态，再落盘：

```ts
const file = Bun.file("input.ass");
const response = await fetch("http://127.0.0.1:3300/api/subset", {
  method: "POST",
  headers: {
    "Content-Type": "application/octet-stream",
    "X-Filename": Buffer.from("input.ass").toString("base64"),
    "X-Fonts-Check": "1",
    "X-Font-Name-Mode": "preserve",
  },
  body: file,
});
const header = response.headers.get("X-Message");
const messages = header
  ? JSON.parse(Buffer.from(header, "base64").toString("utf8"))
  : [];
const code = Number(response.headers.get("X-Code"));
if (!response.ok || code !== 200) {
  throw new Error(`HTTP ${response.status}, X-Code ${code}: ${messages.join("; ")}`);
}
const bytes = await response.arrayBuffer();
if (bytes.byteLength === 0) throw new Error("Empty subtitle response");
await Bun.write("output.ass", bytes);
```

## 处理多个字幕

使用 multipart/form-data，同一个 `file` 字段可出现多次。选项头对整批生效：

```bash
curl -sS \
  -H 'X-Fonts-Check: 1' \
  -F 'file=@first.ass' \
  -F 'file=@second.ass' \
  http://127.0.0.1:3300/api/subset
```

有多个文件且通过批次预检时，返回 JSON，结果顺序与上传文件顺序一致：

```json
{
  "results": [
    {"filename":"first.ass","code":200,"messages":[],"data":"BASE64_SUBTITLE"},
    {"filename":"second.ass","code":300,"messages":["Missing font: [Example]"],"data":null}
  ]
}
```

批次中的任一 `code >= 400` 时 HTTP 状态为 207，否则为 200。严格缺字 `300` 不会单独触发 HTTP 207，仍需逐个检查业务码。批次预检失败会使用单文件的 `X-Code`/`X-Message` 错误响应；客户端应先判断 Content-Type 和状态，不能无条件解析 JSON。

默认最多 20 个文件、每个 8 MiB、整批 32 MiB；管理员可调整。批次内部依次执行，全局同时处理请求数默认 2。重复请求可能命中结果缓存，但仍会生成处理日志。

## 管理与上传鉴权

管理员接口接受 `X-API-Key: 管理员密钥`，部分接口也接受 `Authorization: Bearer 密钥`。成员字体接口接受已启用且未过期的字幕组凭证，使用 `X-API-Key`、`X-Upload-Token` 或 `Authorization: Bearer`；凭证不能执行管理员删除、扫描或凭证管理操作。

- `POST /api/upload`：匿名字体投稿，受公开配额限制。
- `POST /api/v1/upload`：字幕组凭证上传。
- `GET /api/access/whoami`：验证管理员/成员身份。
- `/api/fonts`：字体浏览、下载和上传；删除等操作需要管理员。

凭证与 CLI 更新互不关联。CLI 自更新只访问本仓库的 GitHub Release 和下载主机，不转发服务端 API key。
