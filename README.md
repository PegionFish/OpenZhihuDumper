# OpenZhihuDumper

开放知乎 Dumper — 爬取已登录知乎账号的完整数据归档。

A vibed tool for dumping your personal Zhihu account.

## 介绍

本工具用于爬取你已经登录的知乎账户的全部数据，通过知乎公开 API v4 `/members/{token}` 端点获取。核心脚本为单个 `fetch_zhihu.mjs`（Node.js ESM），无第三方依赖。

本工具目前支持以下功能：
* **个人信息** — 昵称、关注者/关注数、回答/Pin/文章数量
* **回答** — 全部回答（含完整 HTML 内容、赞同/评论/收藏数、时间戳）
* **想法 (Pins)** — 全部想法（含文本内容、图片链接、赞同/评论数）
* **文章 (专栏)** — 全部文章（含标题、正文、时间戳）

## 依赖与环境

**运行时**：[Node.js](https://nodejs.org/) ≥ 18（使用原生 `fetch` API，无需 `node-fetch` 等 polyfill）。

**零 npm 依赖**：脚本仅使用 Node.js 内置模块（`fs`）。不需要 `npm install`，不需要 `package.json`。

**操作系统**：Windows / macOS / Linux 均可。仅在 Windows 11 (PowerShell/Bash) 和 macOS 上测试过。

**磁盘空间**：完整归档一个万级回答的账户约需 5-10 MB（JSON 文本），建议预留充足空间。

## 快速开始

```bash
# 1. 准备 Cookie（见下方说明）
echo "你的Cookie字符串" > zhihu_cookie_header.txt

# 2. 运行
node fetch_zhihu.mjs --token=<目标用户的url_token>
```

## 获取 Cookie

脚本需要一个已登录知乎的 Session Cookie 才能拉取完整内容。不登录则 API 返回受限。

**浏览器 DevTools 方式**：
1. 在浏览器中登录 zhihu.com
2. 打开 DevTools → Network 标签
3. 访问任意知乎页面
4. 找到任意发往 `zhihu.com` 的请求，复制完整的 `Cookie` 请求头
5. 保存到工作目录下的 `zhihu_cookie_header.txt`，或通过 `--cookie="..."` 命令行传入

## 命令行用法

```
node fetch_zhihu.mjs --token=<url_token> [选项]

必选：
  --token=<url_token>     目标用户的知乎 url_token（即个人页 URL 中的 ID）

Cookie（二选一）：
  --cookie="..."          直接传入 Cookie 字符串
  （或自动读取工作目录下的 zhihu_cookie_header.txt）

可选：
  --skip-answers          跳过回答抓取
  --skip-pins             跳过想法抓取
  --skip-articles         跳过文章抓取

环境变量：
  ZHIHU_USER_TOKEN        替代 --token=
```

### 示例

```bash
# 完整归档
node fetch_zhihu.mjs --token=some-user

# 跳过想法，显式传入 Cookie
node fetch_zhihu.mjs --token=some-user --skip-pins --cookie="z_c0=..."
```

### 断点续传

脚本每 100 条自动保存 checkpoint。如果中断，直接重新运行即可 — 它会从已有数据文件中恢复，不重复抓取。已有条目会自动合并（补全缺失的 content、更新点赞/评论数）。

### Cookie 过期

知乎 Cookie 会周期性过期。需要重新从浏览器提取或使用 CDP 自动化刷新（后续版本可能加入）。

## 输出文件

| 文件 | 内容 |
|------|------|
| `zhihu_complete.json` | 全部回答（完整内容 + 统计数据） |
| `zhihu_pins_all.json` | 全部想法（文本 + 图片 + 时间线） |
| `zhihu_articles_all.json` | 全部文章（标题 + 正文） |
| `zhihu_archive_summary.md` | 归档统计摘要 |

所有文件保存在当前工作目录。

### 输出数据结构

**回答** (`zhihu_complete.json`)：
```json
{
  "total": 2849,
  "total_votes": 123491,
  "years": { "2018": 69, "2019": 507, "2020": 1172 },
  "answers": [
    {
      "id": "123456",
      "question": "如何评价...？",
      "votes": 42,
      "comments": 15,
      "collects": 3,
      "created": "2020-03-15T10:30:00.000Z",
      "excerpt": "...",
      "content": "<p>回答正文 HTML...</p>"
    }
  ]
}
```

**想法** (`zhihu_pins_all.json`)：
```json
[
  {
    "date": "2025-06-15",
    "text": "想法文本内容",
    "images": [],
    "links": [],
    "comment_count": 0,
    "like_count": 16,
    "url": "/pins/123456"
  }
]
```

## 速率控制与容错

- 页间延迟 1.5 秒
- 指数退避重试（最多 5 次）
- 遇到 403/429 自动等待 30 秒
- 500 错误优雅终止（知乎已知限制：回答翻页超过 ~2,000 条会出 500）
- 不触发 WBI/412 验证码（v4/members 路径不走 WBI）

## 使用的 API 端点

| 端点 | 说明 |
|------|------|
| `GET /api/v4/members/{token}` | 个人资料 |
| `GET /api/v4/members/{token}/answers` | 回答（分页） |
| `GET /api/v4/members/{token}/pins` | 想法（分页） |
| `GET /api/v4/members/{token}/articles` | 文章（分页） |

所有端点均为公开接口，但需要登录 Cookie 才能返回完整内容。

## 已知限制

- **回答深分页 500**：翻到 ~2,000 条回答后知乎服务端报错，脚本会优雅停止并保存已有数据
- **赞同历史不可访问**：`/members/{token}/vote-up` 端点在 API v4 中对非本人返回 403，需要 CDP 浏览器方案
- **Cookie 过期**：需要定期重新提取

## 警示

基于版权、伦理和可能的法律法规的要求，本工具只适用于在已经登录了特定知乎账号的系统中爬取**该账号自身**的数据。不应被视为/用于/改造成爬取**其他知乎用户**的信息的工具。

## 致谢

感谢 [DeepSeek](https://platform.deepseek.com/) 提供的廉价 SOTA 模型，梁圣伟大无需多言。

## 联系我

[PegionFish](mailto:boblao0714@gmail.com)

## License

MIT