# FontInAss Local

字幕字体嵌入工具的本地部署版本。前端上传 `.ass`/`.ssa`/`.srt` 字幕文件，服务器从本地字体库匹配字体并完成子集化，返回内嵌字体的字幕文件。

**与 [CloudFlare Worker 版](https://font.anibt.net) 的区别：**
- 无内存/CPU 限制 → 支持任意大小的字体文件（CJK 50MB+ 无压力）
- 无批处理数量限制 → 一次处理 100+ 字幕文件
- 本地存储 → 字体直接放在磁盘，无需上传到 R2
- 一键扫描 → 新增 `扫描并索引` 功能，自动识别字体目录下所有字体

## 快速开始

### 环境要求

- [Bun](https://bun.sh) ≥ 1.1  (推荐)
- 或 Node.js ≥ 20 + npx

### 1. 克隆并安装依赖

```bash
git clone <repo-url> fontinass-local
cd fontinass-local

# 安装服务端依赖
cd server && bun install

# 安装前端依赖
cd ../web && bun install
```

### 2. 配置环境变量

```bash
cp server/.env.example server/.env
# 编辑 server/.env，至少设置 API_KEY
```

关键配置项：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 服务器端口 |
| `API_KEY` | _(空)_ | 字体管理接口鉴权密钥，留空则无需鉴权 |
| `FONT_DIR` | `./fonts` | 字体存储目录（相对于 server/ 目录） |
| `DB_PATH` | `./data/fonts.db` | SQLite 数据库路径 |
| `CORS_ORIGIN` | `*` | CORS 来源，生产环境建议设置为前端地址 |
| `SUBSET_CONCURRENCY` | `5` | 并发处理字体数量 |

### 3. 放入字体文件

将字体文件（TTF/OTF/TTC）放入 `server/fonts/` 目录（或 `FONT_DIR` 指定的目录）：

```
server/fonts/
├── 汉仪/
│   ├── 汉仪书宋.ttf
│   └── 汉仪楷体.ttf
├── 微软雅黑.ttc
└── 方正/
    └── FZHei.ttf
```

### 4. 启动开发模式

```bash
# 终端 1：启动服务端（热重载）
cd server && bun --hot src/index.ts

# 终端 2：启动前端开发服务器
cd web && bun run dev
```

访问 http://localhost:5173（前端）或 http://localhost:3000（API）。

### 5. 索引字体

在前端进入 **字体管理 → 索引统计** 标签，点击 **扫描并索引** 按钮。

服务器会扫描 `FONT_DIR` 下所有字体文件并建立索引。索引信息保存在 SQLite 数据库中，后续无需重复扫描（除非添加新字体）。

---

## Docker 部署

```bash
# 1. 创建字体和数据目录（会被挂载到容器内）
mkdir -p fonts data

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，至少设置 API_KEY

# 3. 构建并启动
docker compose up -d

# 查看日志
docker compose logs -f
```

字体文件挂载至容器的 `/app/fonts`（对应宿主机 `./fonts/` 目录），数据库持久化至 `./data/`。

将字体文件放入宿主机的 `./fonts/` 目录后，在前端点击 **扫描并索引** 即可建立索引，无需重启容器。

---

## 生产部署（不用 Docker）

```bash
# 构建前端
cd web && bun run build

# 启动服务端（会自动 serve 前端静态文件）
cd server && bun src/index.ts
```

单进程同时提供 API 和静态文件，访问 http://localhost:3000 即可。

---

## API 文档

所有字体管理接口需要 `X-API-Key: <your-key>` 请求头。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/health` | 健康检查（公开） |
| `GET` | `/api/fonts` | 列出已索引字体（分页+搜索） |
| `POST` | `/api/fonts` | 上传字体文件（multipart） |
| `DELETE` | `/api/fonts/:id` | 删除单个字体 |
| `DELETE` | `/api/fonts` | 批量删除 |
| `GET` | `/api/fonts/browse` | 浏览字体目录树 |
| `GET` | `/api/fonts/list-keys` | 递归列出所有字体键 |
| `POST` | `/api/fonts/index-folder` | 索引指定路径下的字体 |
| `POST` | `/api/fonts/scan-local` | **[本地独有]** 扫描并索引整个字体目录 |
| `GET` | `/api/fonts/stats` | 索引统计 |
| `POST` | `/api/subset` | 字幕子集化（公开，无鉴权） |

---

## 技术栈

- **服务端**: [Bun](https://bun.sh) + [Hono](https://hono.dev) + bun:sqlite
- **字体解析/子集化**: [opentype.js](https://opentype.js.org)
- **前端**: [Vue 3](https://vuejs.org) + [Tailwind CSS v4](https://tailwindcss.com) + [Vite](https://vitejs.dev)
- **部署**: Docker / 直接运行
