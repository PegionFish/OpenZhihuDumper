# OpenZhihuDumper (v2.0.0)

开放知乎 Dumper — 爬取已登录知乎账号的完整数据归档，保留富文本内容。

A tool for dumping your personal Zhihu account with rich content preservation (emoji, images, repost chains, topics).

## 介绍

本工具通过知乎公开 API v4 `/members/{token}` 端点爬取已登录账户的全部数据。v2.0.0 重构为模块化架构，支持富文本完整保留、原图下载、Markdown 导出。

**v2.0.0 新增功能**：
* **富文本保留** — 想法中的 emoji、行内链接、换行不再丢失
* **原图下载** — 自动解析知乎 thumbnail URL，下载最高分辨率原图并替换 HTML 中的路径
* **转发链** — 完整保留想法的转发关系（origin_pin / repin）
* **问题上下文** — HTML 页面补充抓取问题详情、话题标签
* **专栏/话题** — 文章专栏归属和话题标签
* **Markdown 导出** — 按年/月分目录输出，本地离线浏览

**原有功能**：
* **个人信息** — 昵称、关注者/关注数、回答/Pin/文章数量
* **回答** — 全部回答（含完整 HTML 内容、赞同/评论/收藏数、时间戳）
* **想法 (Pins)** — 全部想法（含富文本内容、图片、赞同/评论数）
* **文章 (专栏)** — 全部文章（含标题、正文、时间戳）

## 依赖与环境

**运行时**：[Node.js](https://nodejs.org/) ≥ 18（使用原生 `fetch` API）。

**依赖**：2 个 npm 包（均为 MIT/BSD-2-Clause 兼容许可证）：
- [cheerio](https://github.com/cheeriojs/cheerio) — HTML 解析与重写
- [turndown](https://github.com/mixmark-io/turndown) — HTML → Markdown 转换

**操作系统**：Windows / macOS / Linux 均可。仅在 Windows 11 (PowerShell/Bash) 和 macOS 上测试过。

**磁盘空间**：含图片的完整归档约需 50-200 MB（取决于内容量），建议预留充足空间。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 准备 Cookie（见下方说明）
echo "你的Cookie字符串" > zhihu_cookie_header.txt

# 3. 运行
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

抓取范围：
  --skip-answers          跳过回答抓取
  --skip-pins             跳过想法抓取
  --skip-articles         跳过文章抓取

输出控制 (v2.0.0 新增)：
  --no-images             不下载图片（仅保留原始 URL）
  --no-markdown           不生成 Markdown 文件（仅 JSON）
  --no-enrich             跳过 HTML 页面补充抓取（问题详情/话题/专栏）
  --out-dir=<path>        指定输出目录（默认当前目录）
  --concurrency=<n>       图片下载并发数（默认 5）

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
| `zhihu_complete.json` | 全部回答（含问题详情、话题标签、图片清单） |
| `zhihu_pins_all.json` | 全部想法（含富文本、转发链、图片清单） |
| `zhihu_articles_all.json` | 全部文章（含专栏归属、话题标签） |
| `zhihu_references.json` | 跨内容引用索引（问题→回答、话题索引、转发关系） |
| `zhihu_archive_summary.md` | 归档统计摘要 |
| `images/` | 下载的图片（按内容类型和 ID 分目录） |
| `markdown/` | Markdown 导出文件（按年/月分目录，含 index.md） |

所有文件保存在当前工作目录（或 `--out-dir` 指定路径）。

### 输出数据结构

**回答** (`zhihu_complete.json`)：
```json
{
  "profile": { "name": "...", "url_token": "...", "answer_count": 2400 },
  "total": 409,
  "total_votes": 123491,
  "years": { "2023": 191, "2024": 115 },
  "answers": [
    {
      "id": "3275770022",
      "question": {
        "id": "2047291016621958122",
        "title": "如何看待...？",
        "detail": "<p>问题补充描述 HTML</p>",
        "detail_text": "纯文本",
        "topics": [{"id": "xxx", "name": "科技"}],
        "created": "2025-06-01T..."
      },
      "content_html": "<p>回答正文，图片本地路径...</p>",
      "voteup_count": 174,
      "comment_count": 123,
      "collect_count": 77,
      "created": "2023-11-03T13:02:32.000Z",
      "images": [
        {"original": "https://picx.zhimg.com/...", "full_resolution": "https://picx.zhimg.com/v2-abc.jpg", "local": "images/answer_3275770022/v2-abc.jpg"}
      ]
    }
  ]
}
```

**想法** (`zhihu_pins_all.json`)：
```json
[
  {
    "id": "2043771335239807347",
    "type": "pin",
    "url": "/pins/2043771335239807347",
    "created": "2026-05-29T...",
    "content_html": "<p>文本+<img class='content-emoji' src='images/pins/emoji_01.png'>...</p>",
    "excerpt_title": "...",
    "repin": {
      "author": {"name": "...", "url_token": "...", "avatar_url": "..."},
      "content_html": "...",
      "url": "/pins/xxx",
      "created": "2026-05-28T..."
    },
    "origin_pin": {
      "author": {"name": "...", "url_token": "...", "avatar_url": "..."},
      "content_html": "...",
      "url": "/pins/xxx",
      "created": "2026-05-27T..."
    },
    "like_count": 2,
    "comment_count": 0,
    "images": []
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