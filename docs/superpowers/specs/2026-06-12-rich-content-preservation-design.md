# Rich Content Preservation — Design Spec

**Date**: 2026-06-12
**Status**: Approved
**Target**: `fetch_zhihu.mjs` v2.0.0

## Motivation

Current `fetch_zhihu.mjs` (v1.0.0) strips rich content during extraction:

- **Pins**: `extractPinText()` calls `replace(/<[^>]+>/g, '')` which drops all `<img>` (custom emoji), `<a>` (inline links), `<br>` (line breaks). Images are extracted into separate flat arrays, losing inline position.
- **Answers**: `content` HTML is saved, but question detail (`question.detail`), question topics, and answer images are not captured.
- **Articles**: Column attribution and topics are not captured.

**Goal**: Preserve full rich content — emoji, images, inline formatting, and context associations — for three use cases: local browsing, AI/LLM analysis, and long-term archival.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Module architecture | 4-5 ESM modules in `lib/` | Testable, maintainable, clear boundaries |
| HTML parsing | cheerio (MIT) | Reliable DOM manipulation, ~1MB |
| HTML→Markdown | turndown (MIT) | High-quality conversion with custom rules |
| Image strategy | Download to local + rewrite paths | Offline-readable, never-rot |
| Question enrichment | HTML page scrape (cheerio) | No WBI/x-zse-96 signature needed |
| License compatibility | All MIT or BSD-2-Clause | Safe for MIT redistribution |

All dependencies are MIT/BSD-2-Clause licensed and compatible with MIT redistribution. See [license review](#license-review) below.

## Architecture

```
OpenZhihuDumper/
├── package.json                    # cheerio + turndown dependency
├── fetch_zhihu.mjs                 # CLI entry (~120 lines, orchestration only)
├── lib/
│   ├── constants.mjs               # API endpoints, per_page, CKPT_INTERVAL, HEADERS template
│   ├── fetcher.mjs                 # HTTP requests, pagination, retry, rate-limiting
│   ├── extractors/
│   │   ├── answers.mjs             # Answer extraction: content + question metadata
│   │   ├── pins.mjs                # Pin extraction: rich text + media + repost chain
│   │   └── articles.mjs            # Article extraction: content + column attribution
│   ├── media.mjs                   # Image download, dedup, URL→local path rewriting
│   ├── exporter.mjs                # JSON output + Markdown generation via turndown
│   └── enricher.mjs                # HTML page scraping for question details, topics, columns
├── .gitignore                      # Updated with node_modules/, images/ output patterns
├── README.md                       # Updated usage docs
└── LICENSE                         # MIT
```

### Module Responsibilities

| Module | Answers | Interface | Depends on |
|--------|---------|-----------|------------|
| `constants.mjs` | Where does config come from? | API URL templates, defaults | nothing |
| `fetcher.mjs` | How is data fetched? | `fetchProfile(cookie)`, `fetchAllPages(endpoint, cookie, opts)` | `constants.mjs` |
| `extractors/*.mjs` | How is raw data transformed? | Each exports `extract(item)` and `getInclude()` | cheerio |
| `media.mjs` | How are images saved? | `downloadImages(html, id, outDir)` → `{html, imgDir, manifest}` | Node built-ins |
| `exporter.mjs` | How is output written? | `writeJSON(data, path)`, `writeMarkdown(items, opts)` | turndown |
| `enricher.mjs` | How is missing context filled? | `enrichQuestion(answerId)`, `enrichArticle(articleId)` | cheerio, fetcher |
| `fetch_zhihu.mjs` | How does it all fit together? | Orchestrates above modules, handles CLI args | all above |

## Data Structures

### Answer (zhihu_complete.json)

```json
{
  "profile": {
    "name": "string",
    "url_token": "string",
    "answer_count": 2400,
    "pins_count": 500,
    "articles_count": 59,
    "follower_count": 14832
  },
  "total": 409,
  "total_votes": 123491,
  "years": { "2023": 191 },
  "answers": [
    {
      "id": "3275770022",
      "question": {
        "id": "2047291016621958122",
        "title": "如何看待...？",
        "detail": "<p>问题补充描述 HTML</p>",
        "detail_text": "问题补充描述纯文本",
        "topics": [{"id": "xxx", "name": "科技"}],
        "created": "2025-06-01T..."
      },
      "content_html": "<p>回答正文，图片本地路径...</p>",
      "voteup_count": 174,
      "comment_count": 123,
      "collect_count": 77,
      "created": "2023-11-03T13:02:32.000Z",
      "images": [
        {"original": "https://picx.zhimg.com/...", "local": "images/answer_3275770022/abc.jpg"}
      ]
    }
  ]
}
```

**API verified fields** (`/api/v4/members/{token}/answers`):
- Default returns: `id, type, url, is_collapsed, created_time, updated_time, question.{id, title, question_type, created, updated_time, url}`
- Via include: `content, excerpt, voteup_count, comment_count, collect_count, favorite_count`
- `question.detail` and `question.topics` are NOT included — requires separate enrichment

### Pin (zhihu_pins_all.json)

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
    "like_count": 0,
    "comment_count": 0
  }
]
```

**API verified fields** (`/api/v4/members/{token}/pins`):
- Default returns: `id, type ("pin"), url, source_pin_id, created, updated, comment_count, like_count, repin_count, reaction_count, content[], state, is_deleted, self_create, view_permission`
- Via include: `content[].{type, content, own_text, fold_type}, excerpt_title`
- **Two repost structures coexist**: `origin_pin` (forward others) and `repin` (re-forward). Both contain the full forwarded pin object including `author.{name, url_token, avatar_url}`, `content`, `url`, `created`.
- `tags` field exists but is always empty array (deprecated).
- `topics` field does NOT exist on pins.

### Article (zhihu_articles_all.json)

```json
[
  {
    "id": "721098598",
    "title": "办公室友好的青轴替代品",
    "content_html": "<p>正文...</p>",
    "excerpt": "...",
    "column": {
      "id": "xxx",
      "title": "专栏名称",
      "url": "/column/xxx"
    },
    "topics": [{"id": "xxx", "name": "数码"}],
    "image_url": "images/article_721098598/cover.jpg",
    "voteup_count": 0,
    "comment_count": 0,
    "created": "2023-05-15T...",
    "url": "https://zhuanlan.zhihu.com/p/721098598"
  }
]
```

**API verified fields** (`/api/v4/members/{token}/articles`):
- Default returns: `id, type, title, excerpt, excerpt_title, content, url, image_url, created, updated, voteup_count, comment_count`
- `column` and `topics` are NOT returned in the members/articles endpoint. Enrich via HTML page scrape on `zhuanlan.zhihu.com/p/{id}`.

### Cross-Reference Index (zhihu_references.json)

```json
{
  "questions": {
    "2047291016621958122": {
      "id": "2047291016621958122",
      "title": "如何看待...",
      "answered_by": ["3275770022"],
      "topics": [{"id": "19556664", "name": "知乎"}]
    }
  },
  "topic_index": {
    "19556664": {
      "name": "知乎",
      "answers": ["3275770022"],
      "articles": ["721098598"]
    }
  },
  "pin_reposts": {
    "pin_456": ["pin_123"]
  }
}
```

This file enables walking the relationship graph without scanning all answer/pin bodies.

## Content Extraction

### Pin Content Blocks

The `content` array contains blocks with `type` values. The extractor MUST NOT strip HTML — instead build a single HTML string from all blocks:

| Block type | HTML generation |
|-----------|-----------------|
| `text` | `{content}` as-is (may contain `<img class="content-emoji">`, `<a>`, `<br>`) — wrap in `<p>` if top-level |
| `image` | `<img src="{url}">` |
| `link` | `<a href="{url}">{title}</a>` |
| `video` | `<video src="{url}" poster="{cover}">` |

### Repost Chain

```js
// pins.mjs — repost chain assembly
function extractPin(item) {
  return {
    // ... base fields
    repin:      item.repin      ? extractRepin(item.repin)       : null,
    origin_pin: item.origin_pin ? extractPinPartial(item.origin_pin) : null,
  };
}
```

Reposts can chain: a pin may have `type: "pin"` with an `origin_pin` that itself has a `repin`. The extractor preserves the full chain without recursion limits.

### Question Enrichment

Since `question.detail` and `question.topics` are absent from `/members/{token}/answers`, enrich via HTML page parsing:

```js
// enricher.mjs
async function enrichQuestion(questionId) {
  const html = await fetch(`https://www.zhihu.com/question/${questionId}`, { headers });
  const $ = cheerio.load(html);
  return {
    detail:       $('.QuestionRichText').html() || '',
    detail_text:  $('.QuestionRichText').text() || '',
    topics:       $('.QuestionHeader-topics .TopicLink').map((i, el) => ({
                    id: $(el).attr('href').split('/').pop(),
                    name: $(el).text().trim()
                  })).get()
  };
}
```

Fallback: if the page returns a 403/captcha, skip enrichment silently and leave `detail` and `topics` as empty.

## Image Download

### Discovery

cheerio scans all `<img>` tags. Priority for src: `data-actualsrc` > `data-original` > `src`.

### Download Rules

- Concurrency: max 5 simultaneous downloads via `Promise.allSettled`
- Retry: 2 retries, 1s/3s backoff
- Skip: `data:image` URIs, 1×1 tracking pixels, known analytics domains
- Dedup: same URL → single download, referenced by multiple docs

### Path Rewriting

| Original | After |
|----------|-------|
| `https://picx.zhimg.com/v2-abc123_xl.jpg?source=xxx` | `images/answer_3275770022/v2-abc123_xl.jpg` |

The `src` attribute is rewritten to a relative path. Original URL is preserved in the `images` manifest array on the JSON object.

### Output Layout

```
outDir/
  images/
    answer_3275770022/
      v2-abc123_xl.jpg
    article_721098598/
      v2-def456_r.jpg
    pins/
      v2-ghi789_l.jpg
```

## Markdown Export

### File Structure

```
outDir/
  markdown/
    answers/
      2023/11/3275770022.md
    pins/
      2026/06/2043771335239807347.md
    articles/
      2023/05/721098598.md
    index.md
```

### Template (Answer)

```markdown
# [回答] {question.title}

> 问题补充：{question.detail_text}
> 话题: #topic1 #topic2

发布于 {created} | 赞同 {votes} | 评论 {comments} | 收藏 {collects}

---

{content_markdown}

---

[原始链接](https://www.zhihu.com/answer/{id})
```

### turndown Custom Rules

1. **Emoji preservation**: `<img class="content-emoji">` → `![emoji]({local_path})` (inline, not block)
2. **Zhihu blockquote**: `<blockquote>` → markdown `> ` prefix
3. **Strikethrough/formatting**: Standard turndown rules handle `<b>`, `<i>`, `<s>`, `<code>`

## CLI Interface

```bash
node fetch_zhihu.mjs --token=<url_token> [options]

Required:
  --token=<url_token>       Target user's Zhihu url_token

Cookie (choose one):
  --cookie="..."            Cookie header string
  (auto-reads zhihu_cookie_header.txt)

Fetch scope:
  --skip-answers            Skip answers
  --skip-pins               Skip pins
  --skip-articles           Skip articles

Output control (NEW):
  --no-images               Skip image download (keep URLs)
  --no-markdown             Skip Markdown generation (JSON only)
  --out-dir=<path>          Output directory (default: .)
  --concurrency=<n>         Image download concurrency (default: 5)

Enrichment (NEW):
  --no-enrich               Skip HTML page scraping for question details/topics/columns
```

## Error Handling

| Scenario | Strategy |
|----------|----------|
| Cookie expired/invalid | Exit immediately with clear message |
| API rate limit (403/429) | 30s wait, then retry |
| Server error (500) | Stop gracefully, save checkpoint |
| Image download failure | Skip image, keep original URL, log warning |
| Enrichment page 403/captcha | Skip enrichment silently |
| Network timeout | Exponential backoff (5 retries, max 60s) |

Checkpoint saves every 100 items prevent data loss on interruption.

## License Review

All production dependencies are MIT or BSD-2-Clause licensed:

| Package | License | Compatible with MIT? |
|---------|---------|---------------------|
| cheerio | MIT | ✅ |
| ├─ parse5 | MIT | ✅ |
| ├─ undici | MIT | ✅ |
| ├─ htmlparser2 | MIT | ✅ |
| ├─ dom-serializer | MIT | ✅ |
| ├─ whatwg-mimetype | MIT | ✅ |
| ├─ encoding-sniffer | MIT | ✅ |
| ├─ parse5-parser-stream | MIT | ✅ |
| ├─ parse5-htmlparser2-tree-adapter | MIT | ✅ |
| ├─ domutils | BSD-2-Clause | ✅ |
| ├─ domhandler | BSD-2-Clause | ✅ |
| ├─ cheerio-select | BSD-2-Clause | ✅ |
| turndown | MIT | ✅ |
| ├─ @mixmark-io/domino | BSD-2-Clause | ✅ |

## File Inventory

| File | Action | Est. Lines |
|------|--------|-----------|
| `package.json` | New | ~15 |
| `fetch_zhihu.mjs` | Rewrite | ~120 |
| `lib/constants.mjs` | New | ~40 |
| `lib/fetcher.mjs` | New | ~130 |
| `lib/extractors/answers.mjs` | New | ~80 |
| `lib/extractors/pins.mjs` | New | ~100 |
| `lib/extractors/articles.mjs` | New | ~70 |
| `lib/media.mjs` | New | ~200 |
| `lib/exporter.mjs` | New | ~150 |
| `lib/enricher.mjs` | New | ~120 |
| `.gitignore` | Update | +5 |
| `README.md` | Update | +80 |
| **Total new code** | | **~1110** |
