
<h1 align="center">FontInAss</h1>

<p align="center">
  <strong>开源字幕字体子集化服务</strong><br>
  上传 ASS / SSA / SRT 字幕，自动匹配字体并嵌入精简子集，体积减少 95%+
</p>

<p align="center">
  <a href="https://font.anibt.net">在线服务</a> ·
  <a href="#cli-工具">CLI 工具</a> ·
  <a href="#docker-部署">Docker 部署</a> ·
  <a href="https://t.me/anibtass">Telegram 社群</a>
</p>

---

## 简介

FontInAss 是一个开源的字幕字体子集化工具。将 ASS/SSA/SRT 字幕文件上传后，系统自动从在线字体库中匹配字幕引用的字体，提取实际使用的字符生成极小的子集化字体，并嵌入到字幕文件中。

支持 Web 界面、命令行工具（CLI）和 API 调用三种使用方式。

## 主要功能

- 精准子集化，字体体积减少 95% 以上
- 在线字体库，收录数万款中日韩及西文字体
- 批量处理，无数量限制
- 跨平台 CLI 工具，本地批量处理
- 字幕分享，浏览和下载社区贡献的已处理字幕包
- Docker 一键部署

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

### 配置项

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务器端口 |
| `API_KEY` | _(空)_ | 管理鉴权密钥 |
| `FONT_DIR` | `./fonts` | 字体存储目录 |
| `DB_PATH` | `./data/fonts.db` | 数据库路径 |
| `SUBSET_CONCURRENCY` | `5` | 并发子集化数量 |

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
```

详细文档见 [cli/README.md](cli/README.md)。

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

[GPL-3.0](LICENSE)
