# Rich Content Preservation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `fetch_zhihu.mjs` v1.0.0 into a modular v2.0.0 that preserves rich content (emoji, images, inline formatting, context associations) with local image download and Markdown export.

**Architecture:** 8 ESM modules in `lib/` with clear boundaries. `cheerio` for HTML parsing/rewriting, `turndown` for HTML→Markdown. 2 npm dependencies (all MIT-compatible).

**Tech Stack:** Node.js ≥18, ESM, cheerio ^1.0.0, turndown ^7.2.4

**Parallelism strategy:** Phase 1 is sequential (foundation). Phase 2 runs 7 modules in parallel. Phase 3 integrates everything.

---

## Phase 1: Foundation (sequential — defines shared interfaces)

### Task 1: package.json + LICENSE + .gitignore

**Files:**
- Create: `package.json`
- Create: `LICENSE`
- Modify: `.gitignore`

- [ ] **Step 1: Create LICENSE (MIT)**

```text
MIT License

Copyright (c) 2025 PegionFish

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "open-zhihu-dumper",
  "version": "2.0.0",
  "description": "Zero-dependency-ish tool to dump your personal Zhihu account data with rich content preservation",
  "type": "module",
  "main": "fetch_zhihu.mjs",
  "scripts": {
    "start": "node fetch_zhihu.mjs"
  },
  "keywords": ["zhihu", "archival", "data-portability", "scraper"],
  "author": "PegionFish <boblao0714@gmail.com>",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/PegionFish/OpenZhihuDumper"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "dependencies": {
    "cheerio": "^1.0.0",
    "turndown": "^7.2.4"
  }
}
```

- [ ] **Step 3: Update .gitignore**

Append to existing `.gitignore`:
```
# Dependencies (new)
node_modules/
package-lock.json

# Downloaded images (new)
images/

# Markdown output (new)
markdown/

# IDE (new)
.vscode/
.idea/
*.swp
*.swo
```

- [ ] **Step 4: npm install**

```bash
cd C:/Users/PegionFish/Desktop/OpenZhihuDumper && npm install
```

- [ ] **Step 5: Commit**

```bash
git add package.json LICENSE .gitignore package-lock.json
git commit -m "chore: add package.json, MIT LICENSE, update .gitignore for v2.0.0

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: lib/constants.mjs

**Files:**
- Create: `lib/constants.mjs`

This module has zero dependencies and defines all shared configuration. Other Phase 2 modules import from here.

- [ ] **Step 1: Create lib/constants.mjs**

```js
// Shared configuration for the Zhihu data archival tool.

export const PER_PAGE = 20;
export const REQUEST_DELAY = 1500;      // ms between pages
export const MAX_RETRIES = 5;
export const CKPT_INTERVAL = 100;       // checkpoint save every N items
export const IMAGE_CONCURRENCY = 5;     // simultaneous image downloads
export const IMAGE_RETRIES = 2;         // retries for failed image downloads

export const OUT_DIR = process.cwd();

export function makeHeaders(cookie, userToken) {
  return {
    'Cookie': cookie,
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': `https://www.zhihu.com/people/${userToken}/`,
    'x-requested-with': 'XMLHttpRequest',
  };
}

export const API = {
  PROFILE:   (token) => `https://www.zhihu.com/api/v4/members/${token}?include=name,url_token,answer_count,pins_count,articles_count,followers_count,headline`,
  ANSWERS:   (token) => `https://www.zhihu.com/api/v4/members/${token}/answers`,
  PINS:      (token) => `https://www.zhihu.com/api/v4/members/${token}/pins`,
  ARTICLES:  (token) => `https://www.zhihu.com/api/v4/members/${token}/articles`,
  QUESTION_PAGE: (qid) => `https://www.zhihu.com/question/${qid}`,
  ARTICLE_PAGE:  (aid) => `https://zhuanlan.zhihu.com/p/${aid}`,
};

// Include params — verified against live API
export const ANSWERS_INCLUDE = [
  'data[*].content', 'data[*].excerpt',
  'data[*].voteup_count', 'data[*].comment_count',
  'data[*].collect_count', 'data[*].favorite_count',
  'data[*].created_time', 'data[*].updated_time',
  'data[*].question.title', 'data[*].question.question_type',
  'data[*].question.created', 'data[*].question.updated_time',
  'data[*].url',
].join(',');

export const PINS_INCLUDE = [
  'data[*].content', 'data[*].excerpt', 'data[*].excerpt_title',
  'data[*].created', 'data[*].updated',
  'data[*].comment_count', 'data[*].like_count',
  'data[*].url', 'data[*].source_pin_id',
  'data[*].repin', 'data[*].origin_pin',
  'data[*].type', 'data[*].tags',
].join(',');

export const ARTICLES_INCLUDE = [
  'data[*].title', 'data[*].content', 'data[*].excerpt',
  'data[*].created', 'data[*].updated',
  'data[*].url', 'data[*].voteup_count',
  'data[*].comment_count', 'data[*].image_url',
].join(',');
```

- [ ] **Step 2: Commit**

```bash
git add lib/constants.mjs
git commit -m "feat: add lib/constants.mjs — shared config and API templates

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2: Core Modules (parallel — all 7 can be written simultaneously)

These modules have well-defined interfaces. Once `constants.mjs` is in place, they can all be written in parallel since each only depends on `constants.mjs` + the npm packages.

### Task 3: lib/fetcher.mjs

**Files:**
- Create: `lib/fetcher.mjs`

**Interface:**
```js
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export function loadJSON(file)  → object | null
export function saveJSON(file, data) → void
export async function fetchJSON(url, headers, retries?) → object
export async function fetchProfile(token, cookie) → object
export async function fetchAllPages(endpoint, token, cookie, opts) → array
```

**Key behavior:**
- `fetchJSON`: Rate-limit handling (403/429 → 30s wait), exponential backoff (5 retries), 500 graceful stop, HTML redirect detection
- `fetchAllPages`: Paginated loop with `is_end` check, PER_PAGE offset, 1.5s delay between pages, checkpoint callback every 100 items, mergeItem support for upgrading existing entries
- `loadJSON`/`saveJSON`: Thin wrappers around `fs.readFileSync`/`fs.writeFileSync` with JSON parse/stringify

**Implementation notes:**
- Port the existing `fetchJSON` and `fetchAllPages` from current `fetch_zhihu.mjs` (lines 93-198) into this module
- `fetchProfile` is a thin wrapper: `fetchJSON(API.PROFILE(token), makeHeaders(cookie))`
- Import `PER_PAGE, REQUEST_DELAY, MAX_RETRIES, CKPT_INTERVAL, OUT_DIR, makeHeaders, API` from `./constants.mjs`
- `loadJSON` and `saveJSON` take a filename (not path), join with `OUT_DIR`

- [ ] **Step 1: Write lib/fetcher.mjs**

Port the complete fetcher logic. The `fetchAllPages` signature:

```js
export async function fetchAllPages(endpoint, token, cookie, opts = {}) {
  const { include, existingSet, makeItem, mergeItem, onCheckpoint } = opts;
  const headers = makeHeaders(cookie, token);
  const allItems = [];
  let offset = 0;

  for (let page = 0; ; page++) {
    let url = API[endpoint](token) + `?limit=${PER_PAGE}&offset=${offset}`;
    if (include) url += `&include=${encodeURIComponent(include)}`;

    let data;
    try {
      data = await fetchJSON(url, headers);
    } catch (e) {
      if (e.isServerError) {
        console.warn(`\n  ⚠ Stopped due to server error at offset=${offset}`);
        break;
      }
      throw e;
    }

    const items = data.data || [];
    if (items.length === 0) break;

    for (const item of items) {
      const key = String(item.id || item.url || '');
      if (existingSet && existingSet.has(key)) {
        if (mergeItem) mergeItem(key, item);
        continue;
      }
      const parsed = makeItem ? makeItem(item) : item;
      allItems.push(parsed);
      if (existingSet) existingSet.add(key);
    }

    const total = data.paging?.totals || '?';
    process.stdout.write(`\r  Page ${page + 1}: +${allItems.length} new (total: ${total})`);

    if (allItems.length > 0 && allItems.length % CKPT_INTERVAL === 0) {
      console.log(`\n  [Checkpoint: ${allItems.length} items]`);
      if (onCheckpoint) onCheckpoint(allItems);
    }

    if (data.paging?.is_end || items.length < PER_PAGE) break;
    offset += PER_PAGE;
    await sleep(REQUEST_DELAY);
  }

  console.log(`\n  Total new items fetched: ${allItems.length}`);
  return allItems;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/fetcher.mjs
git commit -m "feat: add lib/fetcher.mjs — API fetch with pagination, retry, checkpoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: lib/media.mjs

**Files:**
- Create: `lib/media.mjs`

**Interface:**
```js
export async function downloadImages(html, itemId, itemType, outDir, concurrency?) → { html, manifest }
```

**Key behavior:**
- Parse HTML with cheerio, find all `<img>` tags
- Extract src: priority `data-actualsrc` > `data-original` > `src`
- Skip: `data:` URIs, blank src, tracking pixels (URL contains `zhihu.com/equation` or image is 1×1)
- Dedup: track downloaded URLs in a Set; same URL gets same local path
- Download with fetch, write to `outDir/images/{itemType}_{itemId}/`
- Filename: extract from URL path last segment (e.g. `v2-abc123_xl.jpg`), strip query params
- Rewrite `<img src>` to relative local path
- Return `{ html: rewrittenHtml, manifest: [{ original, local }, ...] }`
- Concurrency: max N concurrent downloads via `Promise.allSettled` with a simple semaphore
- On download failure: keep original URL, add `failed: true` to manifest entry, log warning

**Implementation notes:**
- Use `fs.promises.mkdir` with `recursive: true` for the image directory
- Use a simple semaphore pattern: `Array.from({length: concurrency}, () => worker(queue))`
- Use `fs.createWriteStream` for streaming downloads (avoids buffering large images in memory)
- `itemType` is one of: `'answer'`, `'pin'`, `'article'`

- [ ] **Step 1: Write lib/media.mjs**

```js
import { load } from 'cheerio';
import fs from 'fs';
import path from 'path';
import { IMAGE_CONCURRENCY, IMAGE_RETRIES } from './constants.mjs';

// ─── Zhihu image URL resolution ────────────────────────────────────────
// Size suffixes between hash and extension that indicate a thumbnail.
// Removing them (and the /50/ prefix) yields the full-resolution original.
const SIZE_SUFFIXES = [
  '_qhd', '_720w', '_480w', '_280w',
  '_b', '_r', '_hd', '_xl', '_l', '_m', '_s', '_t',
];

/**
 * Resolve a zhimg.com URL to its highest-resolution original.
 * Steps:
 *  1. Strip query params (?source=...)
 *  2. Remove /50/ thumbnail path prefix
 *  3. Remove size suffix between hash and extension
 */
function resolveOriginalUrl(url) {
  if (!url) return url;
  // Step 1: strip query string
  let cleaned = url.split('?')[0];
  // Step 2: remove /50/ avatar thumbnail prefix
  cleaned = cleaned.replace(/(\/pic\w\.zhimg\.com)\/50\//, '$1/');
  // Step 3: remove known size suffix
  for (const suffix of SIZE_SUFFIXES) {
    // Match: hash_SUFFIX.ext — the suffix appears right before the extension
    const re = new RegExp(suffix + '(\\.[a-z]+)$', 'i');
    if (re.test(cleaned)) {
      cleaned = cleaned.replace(re, '$1');
      break;
    }
  }
  return cleaned;
}

export async function downloadImages(html, itemId, itemType, outDir, concurrency = IMAGE_CONCURRENCY) {
  if (!html) return { html, manifest: [] };
  const $ = load(html);
  const imgDir = path.join(outDir, 'images', `${itemType}_${itemId}`);
  const manifest = [];
  const urlMap = new Map(); // original thumbnail URL → local filename (for dedup)

  // Collect all <img> tags
  const imgs = [];
  $('img').each((i, el) => {
    const thumbSrc = $(el).attr('data-actualsrc') || $(el).attr('data-original') || $(el).attr('src');
    if (!thumbSrc || thumbSrc.startsWith('data:')) return;
    if (thumbSrc.includes('zhihu.com/equation')) return; // tracking pixel
    const fullSrc = resolveOriginalUrl(thumbSrc);
    imgs.push({ el, thumbSrc, fullSrc });
  });

  // Dedup and download
  const downloads = [];
  for (const { el, thumbSrc, fullSrc } of imgs) {
    if (urlMap.has(fullSrc)) {
      $(el).attr('src', urlMap.get(fullSrc));
      $(el).removeAttr('data-actualsrc data-original srcset');
      continue;
    }
    const urlPath = new URL(fullSrc).pathname;
    const filename = urlPath.split('/').pop() || `img_${Date.now()}.jpg`;
    urlMap.set(fullSrc, filename);
    downloads.push({ el, thumbSrc, fullSrc, filename });
  }

  if (downloads.length === 0) return { html: $.html(), manifest: [] };

  // Ensure directory exists
  fs.mkdirSync(imgDir, { recursive: true });

  // Download with concurrency limit
  const queue = [...downloads];
  async function worker() {
    while (queue.length > 0) {
      const { el, thumbSrc, fullSrc, filename } = queue.shift();
      const dest = path.join(imgDir, filename);
      try {
        // Try full-resolution URL first, fall back to thumbnail
        const resp = await fetchWithRetry(fullSrc, IMAGE_RETRIES);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buffer = Buffer.from(await resp.arrayBuffer());
        fs.writeFileSync(dest, buffer);
        const localPath = path.relative(outDir, dest).replace(/\\/g, '/');
        $(el).attr('src', localPath);
        $(el).removeAttr('data-actualsrc data-original srcset');
        manifest.push({ original: thumbSrc, full_resolution: fullSrc, local: localPath });
      } catch (e) {
        // Fallback: try the original thumbnail URL
        try {
          const resp = await fetchWithRetry(thumbSrc, 1);
          if (!resp.ok) throw e;
          const buffer = Buffer.from(await resp.arrayBuffer());
          fs.writeFileSync(dest, buffer);
          const localPath = path.relative(outDir, dest).replace(/\\/g, '/');
          $(el).attr('src', localPath);
          $(el).removeAttr('data-actualsrc data-original srcset');
          manifest.push({ original: thumbSrc, full_resolution: null, local: localPath });
        } catch (e2) {
          console.warn(`  ⚠ Image download failed: ${thumbSrc.slice(0, 80)} — ${e2.message}`);
          manifest.push({ original: thumbSrc, full_resolution: null, local: null, failed: true });
        }
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  return { html: $.html(), manifest };
}

async function fetchWithRetry(url, retries) {
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.zhihu.com/',
        },
      });
      if (resp.ok || i === retries) return resp;
    } catch (e) {
      if (i === retries) throw e;
    }
    await new Promise(r => setTimeout(r, 1000 * (i + 1)));
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/media.mjs
git commit -m "feat: add lib/media.mjs — image download with dedup and path rewriting

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: lib/extractors/answers.mjs

**Files:**
- Create: `lib/extractors/answers.mjs`

**Interface:**
```js
export function getAnswersInclude() → string
export function extractAnswer(item) → object
export function mergeAnswer(existing, item) → boolean  // returns true if upgraded
```

**Key behavior:**
- `getAnswersInclude()` returns the ANSWERS_INCLUDE string
- `extractAnswer(item)` maps a raw API item to the cleaned answer object per spec
- `mergeAnswer(existing, item)` upgrades an existing entry (adds content if missing, updates counts)
- Returns `null` for deleted/empty items

**Implementation notes:**
- Import `{ ANSWERS_INCLUDE }` from `../constants.mjs` for `getAnswersInclude()`
- Extract: `id → String(item.id)`, `question → { id, title }`, timestamps → ISO strings, counters → 0 default
- Question detail and topics are NOT extracted here (handled by enricher.mjs later)

```js
// extractAnswer example
export function extractAnswer(item) {
  return {
    id: String(item.id),
    question: {
      id: String(item.question?.id || ''),
      title: item.question?.title || '',
      detail: '',           // filled by enricher
      detail_text: '',      // filled by enricher
      topics: [],           // filled by enricher
      created: item.question?.created
        ? new Date(item.question.created * 1000).toISOString() : '',
    },
    content_html: item.content || '',
    excerpt: item.excerpt || '',
    voteup_count: item.voteup_count ?? 0,
    comment_count: item.comment_count ?? 0,
    collect_count: item.collect_count ?? item.favorite_count ?? 0,
    created: item.created_time
      ? new Date(item.created_time * 1000).toISOString() : '',
    images: [],             // filled by media.mjs after download
  };
}
```

- [ ] **Step 1: Write lib/extractors/answers.mjs**
- [ ] **Step 2: Commit**

```bash
git add lib/extractors/answers.mjs
git commit -m "feat: add lib/extractors/answers.mjs — answer data extraction

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: lib/extractors/pins.mjs

**Files:**
- Create: `lib/extractors/pins.mjs`

**Interface:**
```js
export function getPinsInclude() → string
export function extractPin(item) → object
```

**Key behavior:**
- Build HTML from `content[]` blocks: text → wrap in `<p>`, image → `<img>`, link → `<a>`, video → `<video>`
- Extract `origin_pin` and `repin` chains recursively
- Preserve `excerpt_title` for repost comments

```js
// Content blocks → HTML
export function renderContentBlocks(blocks) {
  if (!blocks || !Array.isArray(blocks)) return '';
  return blocks.map(block => {
    switch (block.type) {
      case 'text':
        return `<p>${block.content || ''}</p>`;
      case 'image':
        return `<img src="${block.content?.url || ''}" alt="">`;
      case 'link':
        return `<a href="${block.content?.url || ''}">${block.content?.title || ''}</a>`;
      case 'video':
        return `<video src="${block.content?.url || ''}" poster="${block.content?.cover || ''}"></video>`;
      default:
        return '';
    }
  }).join('\n');
}

export function extractPinAuthor(raw) {
  if (!raw) return null;
  return {
    name: raw.name || '',
    url_token: raw.url_token || '',
    avatar_url: raw.avatar_url || '',
  };
}

export function extractPinPartial(raw) {
  if (!raw) return null;
  return {
    author: extractPinAuthor(raw.author),
    content_html: renderContentBlocks(raw.content),
    url: raw.url || '',
    created: raw.created ? new Date(raw.created * 1000).toISOString() : '',
  };
}

export function extractPin(item) {
  return {
    id: String(item.id),
    type: item.type || 'pin',
    url: item.url || '',
    created: item.created ? new Date(item.created * 1000).toISOString() : '',
    content_html: renderContentBlocks(item.content),
    excerpt_title: item.excerpt_title || '',
    repin: item.repin ? extractPinPartial(item.repin) : null,
    origin_pin: item.origin_pin ? extractPinPartial(item.origin_pin) : null,
    like_count: item.like_count || 0,
    comment_count: item.comment_count || 0,
    images: [],             // filled by media.mjs
  };
}
```

- [ ] **Step 1: Write lib/extractors/pins.mjs**
- [ ] **Step 2: Commit**

```bash
git add lib/extractors/pins.mjs
git commit -m "feat: add lib/extractors/pins.mjs — pin extraction with rich content and repost chains

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: lib/extractors/articles.mjs

**Files:**
- Create: `lib/extractors/articles.mjs`

**Interface:**
```js
export function getArticlesInclude() → string
export function extractArticle(item) → object
export function mergeArticle(existing, item) → boolean
```

**Key behavior:**
- Extract core fields from `/members/{token}/articles` API response
- Column and topics left empty — filled by enricher.mjs later
- Merge: upgrade content if existing entry lacks it

```js
export function extractArticle(item) {
  return {
    id: String(item.id),
    title: item.title || '',
    content_html: item.content || '',
    excerpt: item.excerpt || '',
    column: null,           // filled by enricher
    topics: [],             // filled by enricher
    image_url: item.image_url || '',
    voteup_count: item.voteup_count || 0,
    comment_count: item.comment_count || 0,
    created: item.created ? new Date(item.created * 1000).toISOString() : '',
    updated: item.updated ? new Date(item.updated * 1000).toISOString() : '',
    url: item.url || '',
    images: [],             // filled by media.mjs
  };
}
```

- [ ] **Step 1: Write lib/extractors/articles.mjs**
- [ ] **Step 2: Commit**

```bash
git add lib/extractors/articles.mjs
git commit -m "feat: add lib/extractors/articles.mjs — article data extraction

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: lib/enricher.mjs

**Files:**
- Create: `lib/enricher.mjs`

**Interface:**
```js
export async function enrichQuestion(questionId, cookie, userToken) → { detail, detail_text, topics }
export async function enrichArticle(articleId, cookie, userToken) → { column, topics }
```

**Key behavior:**
- Fetch the HTML page for the question/article
- Parse with cheerio to extract detail/topics/column
- Graceful degradation: return empty values on any error (403, timeout, captcha)

```js
import { load } from 'cheerio';
import { makeHeaders } from './constants.mjs';

export async function enrichQuestion(questionId, cookie, userToken) {
  try {
    const url = `https://www.zhihu.com/question/${questionId}`;
    const resp = await fetch(url, { headers: makeHeaders(cookie, userToken) });
    if (!resp.ok) return { detail: '', detail_text: '', topics: [] };
    const html = await resp.text();
    const $ = load(html);

    const detail = $('.QuestionRichText').html() || '';
    const detail_text = $('.QuestionRichText').text() || '';
    const topics = [];
    $('.QuestionHeader-topics .TopicLink, .QuestionTopic .Popover div').each((i, el) => {
      const href = $(el).attr('href') || $(el).find('a').attr('href') || '';
      const name = $(el).text().trim();
      const id = href.split('/').pop();
      if (name && id) topics.push({ id, name });
    });

    return { detail, detail_text, topics };
  } catch {
    return { detail: '', detail_text: '', topics: [] };
  }
}

export async function enrichArticle(articleSlug, cookie, userToken) {
  try {
    const url = `https://zhuanlan.zhihu.com/p/${articleSlug}`;
    const resp = await fetch(url, { headers: makeHeaders(cookie, userToken) });
    if (!resp.ok) return { column: null, topics: [] };
    const html = await resp.text();
    const $ = load(html);

    const columnEl = $('.ColumnLink, .Post-Header .ColumnLink');
    const column = columnEl.length ? {
      id: (columnEl.attr('href') || '').split('/').pop() || '',
      title: columnEl.text().trim() || '',
      url: columnEl.attr('href') || '',
    } : null;

    const topics = [];
    $('.TopicLink').each((i, el) => {
      const href = $(el).attr('href') || '';
      const name = $(el).text().trim();
      const id = href.split('/').pop();
      if (name && id) topics.push({ id, name });
    });

    return { column, topics };
  } catch {
    return { column: null, topics: [] };
  }
}
```

- [ ] **Step 1: Write lib/enricher.mjs**
- [ ] **Step 2: Commit**

```bash
git add lib/enricher.mjs
git commit -m "feat: add lib/enricher.mjs — HTML page scraping for question details and topics

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: lib/exporter.mjs

**Files:**
- Create: `lib/exporter.mjs`

**Interface:**
```js
export function saveJSON(file, data) → void
export function loadJSON(file) → object | null
export async function exportMarkdown(answers, pins, articles, outDir, opts?) → void
```

**Key behavior:**
- `saveJSON` / `loadJSON`: thin wrappers (same as current code)
- `exportMarkdown`: generates `markdown/` tree with turndown
- Custom turndown rules for emoji preservation and blockquotes
- Generates `markdown/index.md` with stats and links

**Turndown setup:**
```js
import TurndownService from 'turndown';

function createTurndownService() {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });

  // Custom rule: keep emoji images inline
  td.addRule('content-emoji', {
    filter: (node) => node.tagName === 'IMG' && (
      node.classList?.contains('content-emoji') ||
      node.getAttribute('class')?.includes('emoji')
    ),
    replacement: (content, node) => {
      const src = node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') || 'emoji';
      return `![${alt}](${src})`;
    },
  });

  return td;
}
```

**Markdown file layout:**
```
markdown/
  answers/2023/11/3275770022.md
  pins/2026/06/2043771335239807347.md
  articles/2023/05/721098598.md
  index.md
```

Answer template:
```markdown
# [回答] {question.title}

> 话题: #topic1 #topic2
> 问题补充：{question.detail_text}

发布于 {created} | 赞同 {votes} | 评论 {comments} | 收藏 {collects}

---

{content_markdown}

---

[原始链接](https://www.zhihu.com/answer/{id})
```

Pin template:
```markdown
# [想法] {date}

{content_markdown}

发布于 {created} | 赞同 {likes} | 评论 {comments}

[原始链接](https://www.zhihu.com{pin.url})
```

Index template:
```markdown
# Zhihu Archive — {name}

Archived: {date}

## Stats

| Type | Count |
|------|-------|
| Answers | {n} |
| Pins | {n} |
| Articles | {n} |

## Answers by Year

| Year | Count |
|------|-------|
| ... | ... |
```

- [ ] **Step 1: Write lib/exporter.mjs**
- [ ] **Step 2: Commit**

```bash
git add lib/exporter.mjs
git commit -m "feat: add lib/exporter.mjs — JSON save/load + Markdown export via turndown

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3: Integration (sequential — depends on all Phase 2 modules)

### Task 10: Rewrite fetch_zhihu.mjs

**Files:**
- Modify: `fetch_zhihu.mjs` (full rewrite)

The new `fetch_zhihu.mjs` is a thin orchestration layer (~120 lines):

```js
#!/usr/bin/env node
// Zhihu Data Archival Tool v2.0.0 — Rich content preservation
// Usage: node fetch_zhihu.mjs --token=<url_token> [options]

import fs from 'fs';
import { OUT_DIR } from './lib/constants.mjs';
import { fetchProfile, fetchAllPages, loadJSON, saveJSON } from './lib/fetcher.mjs';
import { getAnswersInclude, extractAnswer, mergeAnswer } from './lib/extractors/answers.mjs';
import { getPinsInclude, extractPin } from './lib/extractors/pins.mjs';
import { getArticlesInclude, extractArticle, mergeArticle } from './lib/extractors/articles.mjs';
import { downloadImages } from './lib/media.mjs';
import { exportMarkdown } from './lib/exporter.mjs';
import { enrichQuestion, enrichArticle } from './lib/enricher.mjs';

// ─── CLI ──────────────────────────────────────────────────────────────
function getArg(flag) {
  const arg = process.argv.find(a => a.startsWith(flag));
  return arg ? arg.slice(flag.length) : null;
}

const USER_TOKEN = getArg('--token=') || process.env.ZHIHU_USER_TOKEN;
if (!USER_TOKEN) {
  console.error('ERROR: --token=<url_token> is required.');
  console.error('Usage: node fetch_zhihu.mjs --token=<url_token> [--cookie="..."]');
  process.exit(1);
}

const SKIP = {
  answers:  process.argv.includes('--skip-answers'),
  pins:     process.argv.includes('--skip-pins'),
  articles: process.argv.includes('--skip-articles'),
};
const NO_IMAGES   = process.argv.includes('--no-images');
const NO_MARKDOWN = process.argv.includes('--no-markdown');
const NO_ENRICH   = process.argv.includes('--no-enrich');
const OUT_DIR_CLI = getArg('--out-dir=') || OUT_DIR;
const CONCURRENCY = parseInt(getArg('--concurrency=') || '5', 10);

function getCookie() {
  const arg = getArg('--cookie=');
  if (arg) return arg;
  try {
    return fs.readFileSync('zhihu_cookie_header.txt', 'utf8').trim();
  } catch {
    console.error('No cookie. Pass --cookie="..." or save to zhihu_cookie_header.txt');
    process.exit(1);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════');
  console.log('   ZHIHU DATA ARCHIVAL v2.0.0');
  console.log('   Target: ' + USER_TOKEN);
  console.log('   Output: ' + OUT_DIR_CLI);
  console.log('═══════════════════════════════════════\n');

  const cookie = getCookie();
  console.log(`Cookie: ${cookie.slice(0, 40)}...`);

  // Verify
  console.log('Verifying cookie...');
  const profile = await fetchProfile(USER_TOKEN, cookie);
  console.log(`✓ Logged in as: ${profile.name}`);
  console.log(`  Answers: ${profile.answer_count} | Pins: ${profile.pins_count} | Articles: ${profile.articles_count}\n`);

  let answers = null, pins = null, articles = null;

  // ── Answers ──────────────────────────────────────────────────────
  if (!SKIP.answers) {
    console.log('═══════════════════════════════════════');
    console.log('   FETCHING ANSWERS');
    console.log('═══════════════════════════════════════');
    const existing = loadJSON('zhihu_complete.json');
    const existingMap = new Map();
    for (const a of (existing?.answers || [])) existingMap.set(a.id, a);
    const existingIds = new Set(existingMap.keys());
    let upgradedCount = 0;

    const newItems = await fetchAllPages('ANSWERS', USER_TOKEN, cookie, {
      include: getAnswersInclude(),
      existingSet: existingIds,
      makeItem: extractAnswer,
      mergeItem: (id, item) => {
        const entry = existingMap.get(id);
        if (entry && mergeAnswer(entry, item)) upgradedCount++;
      },
      onCheckpoint: (items) => {
        const merged = new Map(existingMap);
        for (const a of items) merged.set(a.id, a);
        finalizeAnswers(merged, 0);
      },
    });

    // Merge
    for (const a of newItems) {
      if (!existingMap.has(a.id)) existingMap.set(a.id, a);
    }

    // Enrich questions
    if (!NO_ENRICH) {
      console.log('\nEnriching question details...');
      const questionsToEnrich = [...new Set(newItems.map(a => a.question.id).filter(Boolean))];
      let enriched = 0;
      for (const qid of questionsToEnrich) {
        const data = await enrichQuestion(qid, cookie, USER_TOKEN);
        if (data.detail || data.topics.length > 0) {
          for (const a of existingMap.values()) {
            if (a.question.id === qid) {
              a.question.detail = data.detail || '';
              a.question.detail_text = data.detail_text || '';
              a.question.topics = data.topics;
            }
          }
          enriched++;
        }
      }
      console.log(`  Enriched ${enriched}/${questionsToEnrich.length} questions`);
    }

    // Download images
    if (!NO_IMAGES) {
      console.log('\nDownloading answer images...');
      let imgCount = 0;
      for (const a of existingMap.values()) {
        if (a.content_html) {
          const result = await downloadImages(a.content_html, a.id, 'answer', OUT_DIR_CLI, CONCURRENCY);
          a.content_html = result.html;
          a.images = result.manifest;
          imgCount += result.manifest.filter(m => !m.failed).length;
        }
      }
      console.log(`  Downloaded ${imgCount} images`);
    }

    finalizeAnswers(existingMap, upgradedCount);
  }

  // ── Pins ──────────────────────────────────────────────────────────
  // ... (same pattern: fetch, enrich, download images, save)

  // ── Articles ──────────────────────────────────────────────────────
  // ... (same pattern: fetch, enrich, download images, save)

  // ── Markdown ──────────────────────────────────────────────────────
  if (!NO_MARKDOWN) {
    console.log('\nGenerating Markdown...');
    await exportMarkdown(answers, pins, articles, OUT_DIR_CLI);
    console.log('  Markdown exported.');
  }

  // ── Cross-reference ───────────────────────────────────────────────
  saveJSON('zhihu_references.json', buildReferences(answers, pins, articles));

  // ── Summary ───────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log('   ARCHIVAL COMPLETE');
  console.log('═══════════════════════════════════════');
}

main().catch(e => {
  console.error('\nFatal:', e.message);
  process.exit(1);
});

// Helper functions (finalizeAnswers, finalizePins, finalizeArticles, buildReferences, etc.)
// Ported from existing code with updated data structures
```

The complete `fetch_zhihu.mjs` should:
1. Port existing checkpoint logic, statistics computation, and summary generation
2. Wire in image download between extraction and save
3. Wire in enrichment (question details, article columns) when `--no-enrich` is not set
4. Generate Markdown when `--no-markdown` is not set
5. Generate `zhihu_references.json` cross-reference index
6. Save the updated `zhihu_archive_summary.md`

- [ ] **Step 1: Rewrite fetch_zhihu.mjs**
- [ ] **Step 2: Commit**

```bash
git add fetch_zhihu.mjs
git commit -m "feat: rewrite fetch_zhihu.mjs as v2.0.0 orchestration layer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Update README.md

**Files:**
- Modify: `README.md`

Update the README to reflect v2.0.0 changes:
- New dependency section: `npm install` required
- New CLI flags: `--no-images`, `--no-markdown`, `--out-dir`, `--concurrency`, `--no-enrich`
- New output files: `zhihu_references.json`, `markdown/` directory, `images/` directory
- Updated data structure documentation with new JSON fields
- Mention rich content preservation (emoji, images, inline formatting)

- [ ] **Step 1: Update README.md**
- [ ] **Step 2: Add Markdown/images to .gitignore if not already**

- [ ] **Step 3: Commit**

```bash
git add README.md .gitignore
git commit -m "docs: update README for v2.0.0 features and new CLI flags

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Integration Test

**What:** Run the tool against a real user token to verify the full pipeline works.

- [ ] **Step 1: Run the tool**

```bash
cd C:/Users/PegionFish/Desktop/OpenZhihuDumper
node fetch_zhihu.mjs --token=ge-yu-ting-zhu-82 --cookie="$(cat ../test/zhihu_cookie_header.txt)" --out-dir=./test_output --skip-pins --skip-articles --no-enrich --no-images --no-markdown
```

Expected: Profile verification succeeds, answers are fetched, JSON saved to `test_output/zhihu_complete.json`.

- [ ] **Step 2: Verify output**

Check `test_output/zhihu_complete.json`:
- Has `profile`, `total`, `total_votes`, `years`, `answers` fields
- Each answer has `id`, `question.{id, title, detail, detail_text, topics, created}`, `content_html`, `voteup_count`, `comment_count`, `collect_count`, `created`, `images`
- Answer IDs are strings

- [ ] **Step 3: Clean up and commit any fixes**

```bash
rm -rf test_output
git add -A && git commit -m "test: verified v2.0.0 answers pipeline with real API

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Push to GitHub**

```bash
git push origin main
```

---

## Dependency Graph

```
Phase 1 (sequential):
  T1: package.json → T2: constants.mjs

Phase 2 (parallel):
  T3: fetcher.mjs    ─┐
  T4: media.mjs       ├─ all can start after T2
  T5: answers.mjs     ├─ (each only imports constants)
  T6: pins.mjs        ├─
  T7: articles.mjs    ├─
  T8: enricher.mjs   ─┤
  T9: exporter.mjs   ─┘

Phase 3 (sequential, after all Phase 2):
  T10: fetch_zhihu.mjs (imports all above)
  T11: README.md update
  T12: Integration test
```

## Files Summary

| File | Task |
|------|------|
| `package.json` | T1 — Create |
| `LICENSE` | T1 — Create |
| `.gitignore` | T1 — Modify |
| `lib/constants.mjs` | T2 — Create |
| `lib/fetcher.mjs` | T3 — Create |
| `lib/media.mjs` | T4 — Create |
| `lib/extractors/answers.mjs` | T5 — Create |
| `lib/extractors/pins.mjs` | T6 — Create |
| `lib/extractors/articles.mjs` | T7 — Create |
| `lib/enricher.mjs` | T8 — Create |
| `lib/exporter.mjs` | T9 — Create |
| `fetch_zhihu.mjs` | T10 — Rewrite |
| `README.md` | T11 — Modify |
