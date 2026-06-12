// Zhihu Data Archival Script — fetches answers (with full content), pins, and articles
// via the Zhihu public API v4 /members/{token} endpoints.
//
// Usage:
//   node fetch_zhihu.mjs --token=<url_token> [--cookie="..."] [flags]
//
//   --token=<url_token>      (Required) Target user's Zhihu url_token
//   --cookie="..."           Cookie header string for auth, or reads from zhihu_cookie_header.txt
//   --skip-answers           Skip answers fetch
//   --skip-pins              Skip pins fetch
//   --skip-articles          Skip articles fetch
//
// Authentication: A logged-in Zhihu cookie is required. The cookie is read from
// zhihu_cookie_header.txt in the working directory, or passed via --cookie=.
// Without it, the API returns limited results.
//
// Output files (saved in current working directory):
//   zhihu_complete.json      — all answers with full content
//   zhihu_pins_all.json      — all pins / 想法
//   zhihu_articles_all.json  — all articles / 专栏
//   zhihu_archive_summary.md — statistics summary
//
// Checkpoints are saved periodically so partial runs are not wasted.

import fs from 'fs';

// ─── Config ───────────────────────────────────────────────────────────────────
const PER_PAGE = 20;
const REQUEST_DELAY = 1500;      // ms between pages
const MAX_RETRIES = 5;
const CKPT_INTERVAL = 100;       // checkpoint save every N new items
const OUT_DIR = process.cwd();

// ─── CLI ──────────────────────────────────────────────────────────────────────
function getArg(flag) {
  const arg = process.argv.find(a => a.startsWith(flag));
  if (!arg) return null;
  return arg.slice(flag.length);
}

const USER_TOKEN = getArg('--token=') || process.env.ZHIHU_USER_TOKEN;
if (!USER_TOKEN) {
  console.error('ERROR: --token=<url_token> is required.');
  console.error('Usage: node fetch_zhihu.mjs --token=<url_token> [--cookie="..."]');
  process.exit(1);
}

const SKIP = {
  answers: process.argv.includes('--skip-answers'),
  pins: process.argv.includes('--skip-pins'),
  articles: process.argv.includes('--skip-articles'),
};

// ─── Cookie ───────────────────────────────────────────────────────────────────
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

function makeHeaders(cookie) {
  return {
    'Cookie': cookie,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': `https://www.zhihu.com/people/${USER_TOKEN}/`,
    'x-requested-with': 'XMLHttpRequest',
  };
}

// ─── Utilities ────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadJSON(file) {
  const path = `${OUT_DIR}/${file}`;
  try { return JSON.parse(fs.readFileSync(path, 'utf8')); } catch { return null; }
}

function saveJSON(file, data) {
  const path = `${OUT_DIR}/${file}`;
  fs.writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
  console.log(`  ✓ Saved ${path}`);
}

// ─── Rate-limited fetch with retry ────────────────────────────────────────────
async function fetchJSON(url, headers, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, { headers, redirect: 'manual' });
      const text = await resp.text();

      if (text.trim().startsWith('<')) {
        const titleMatch = text.match(/<title>([^<]+)<\/title>/);
        const title = titleMatch ? titleMatch[1] : 'HTML page';
        if (resp.status === 403 || resp.status === 429) {
          const wait = 30000;
          console.warn(`  ⚠ 403/429 — rate limited, waiting ${wait/1000}s...`);
          await sleep(wait);
          continue;
        }
        if (resp.status === 500) {
          throw Object.assign(new Error(`Server error (500)`), { status: 500, isServerError: true });
        }
        throw new Error(`HTML response (${resp.status}): ${title}`);
      }

      const data = JSON.parse(text);
      if (data.error) {
        if (data.error.code === 40362) {
          const wait = 30000;
          console.warn(`  ⚠ Rate limited, waiting ${wait/1000}s...`);
          await sleep(wait);
          continue;
        }
        throw new Error(`API error: ${data.error.message}`);
      }
      return data;
    } catch (e) {
      if (e.isServerError || e.status === 500) throw e;
      if (e.message?.includes('HTML') && e.message.includes('(500)')) throw e;
      if (attempt === retries) throw e;
      const wait = 5000 * Math.pow(2, attempt);
      console.warn(`  ⚠ ${e.message}, retry ${attempt+1}/${retries} in ${wait/1000}s...`);
      await sleep(wait);
    }
  }
}

// ─── Profile ──────────────────────────────────────────────────────────────────
async function fetchProfile(headers) {
  return fetchJSON(
    `https://www.zhihu.com/api/v4/members/${USER_TOKEN}?include=name,url_token,answer_count,pins_count,articles_count,followers_count,headline`,
    headers
  );
}

// ─── Paginated fetch with checkpoint saves ────────────────────────────────────
async function fetchAllPages(endpoint, headers, opts = {}) {
  const { include, existingSet, makeItem, mergeItem } = opts;
  const allItems = [];
  let offset = 0;
  let currentPage = 0;

  for (; ; currentPage++) {
    let url = `https://www.zhihu.com/api/v4/members/${USER_TOKEN}${endpoint}?limit=${PER_PAGE}&offset=${offset}`;
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

    let addedThisPage = 0;
    for (const item of items) {
      const key = makeKey(item);
      if (existingSet && existingSet.has(key)) {
        if (mergeItem) mergeItem(key, item);
        continue;
      }
      const parsed = makeItem ? makeItem(item) : item;
      allItems.push(parsed);
      if (existingSet) existingSet.add(key);
      addedThisPage++;
    }

    const total = data.paging?.totals || '?';
    process.stdout.write(`\r  Page ${currentPage + 1}: +${allItems.length} new (total: ${total})`);

    // Checkpoint save
    if (allItems.length > 0 && allItems.length % CKPT_INTERVAL === 0) {
      console.log(`\n  [Checkpoint: ${allItems.length} items]`);
      if (opts.onCheckpoint) opts.onCheckpoint(allItems);
    }

    if (data.paging?.is_end || items.length < PER_PAGE) break;
    offset += PER_PAGE;
    await sleep(REQUEST_DELAY);
  }

  console.log(`\n  Total new items fetched: ${allItems.length}`);
  return allItems;
}

function makeKey(item) {
  return String(item.id || item.url || '');
}

// ─── ANSWERS ──────────────────────────────────────────────────────────────────
async function fetchAllAnswers(headers) {
  console.log('\n═══════════════════════════════════════');
  console.log('   FETCHING ANSWERS');
  console.log('═══════════════════════════════════════');

  const existing = loadJSON('zhihu_complete.json');
  const existingMap = new Map();
  for (const a of (existing?.answers || [])) existingMap.set(String(a.id), a);
  console.log(`Existing: ${existingMap.size} answers (${existing?.answers?.filter?.(a => a.content)?.length || 0} with content)`);

  const existingIds = new Set(existingMap.keys());

  const include = [
    'data[*].content', 'data[*].excerpt',
    'data[*].voteup_count', 'data[*].comment_count',
    'data[*].collect_count', 'data[*].favorite_count',
    'data[*].created_time', 'data[*].updated_time',
    'data[*].question.title', 'data[*].question.question_type',
    'data[*].url',
  ].join(',');

  let upgradedCount = 0;

  const newItems = await fetchAllPages('/answers', headers, {
    include,
    existingSet: existingIds,
    makeItem: item => ({
      id: String(item.id),
      question: item.question?.title || '',
      votes: item.voteup_count ?? 0,
      comments: item.comment_count ?? 0,
      collects: item.collect_count ?? item.favorite_count ?? 0,
      created: new Date((item.created_time || 0) * 1000).toISOString(),
      excerpt: item.excerpt || '',
      content: item.content || '',
    }),
    mergeItem: (id, item) => {
      const entry = existingMap.get(id);
      if (!entry) return;
      let changed = false;
      if (!entry.content && item.content) {
        entry.content = item.content; changed = true;
      }
      if (!entry.excerpt && item.excerpt) {
        entry.excerpt = item.excerpt; changed = true;
      }
      if (item.voteup_count !== undefined && item.voteup_count > (entry.votes || 0)) {
        entry.votes = item.voteup_count; changed = true;
      }
      if (item.comment_count !== undefined && item.comment_count > (entry.comments || 0)) {
        entry.comments = item.comment_count; changed = true;
      }
      if (changed) upgradedCount++;
    },
    onCheckpoint: (allNew) => {
      saveCheckpointAnswers(existingMap, allNew);
    },
  });

  // Merge new into map
  for (const a of newItems) {
    const id = String(a.id);
    if (!existingMap.has(id)) {
      existingMap.set(id, a);
    }
  }

  return finalizeAnswers(existingMap, upgradedCount);
}

function saveCheckpointAnswers(existingMap, newItems) {
  const merged = new Map(existingMap);
  for (const a of newItems) merged.set(String(a.id), a);
  finalizeAnswers(merged, 0);
}

function finalizeAnswers(answerMap, upgradedCount) {
  const answers = [...answerMap.values()].sort(
    (a, b) => new Date(a.created || 0) - new Date(b.created || 0)
  );
  const years = {};
  for (const a of answers) {
    const y = new Date(a.created || 0).getFullYear();
    if (y > 2000) years[y] = (years[y] || 0) + 1;
  }
  const totalVotes = answers.reduce((s, a) => s + (a.votes || 0), 0);
  const withContent = answers.filter(a => a.content).length;

  const result = { total: answers.length, total_votes: totalVotes, years, answers };
  saveJSON('zhihu_complete.json', result);
  const yStr = Object.entries(years).sort(([a],[b])=>a-b).map(([y,c])=>`${y}:${c}`).join(', ');
  console.log(`Answers done: ${answers.length} total (${withContent} with content) [${yStr}]`);
  if (upgradedCount) console.log(`  (${upgradedCount} existing entries upgraded with content)`);
  return result;
}

// ─── PINS ─────────────────────────────────────────────────────────────────────
function pinDateStr(pin) {
  return pin.created ? new Date(pin.created * 1000).toISOString().split('T')[0] : '';
}

function extractPinText(content) {
  if (!content || !Array.isArray(content)) return '';
  return content
    .filter(c => c.type === 'text')
    .map(c => c.content || c.own_text || '')
    .join('\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '');
}

function extractPinMedia(content, type) {
  if (!content || !Array.isArray(content)) return [];
  return content.filter(c => c.type === type).map(c => c.content?.url || '').filter(Boolean);
}

async function fetchAllPins(headers) {
  console.log('\n═══════════════════════════════════════');
  console.log('   FETCHING PINS (想法)');
  console.log('═══════════════════════════════════════');

  const existing = loadJSON('zhihu_pins_all.json') || [];
  console.log(`Existing: ${existing.length} pins`);

  const existingUrls = new Set(existing.filter(p => p.url).map(p => p.url));

  const include = [
    'data[*].content', 'data[*].excerpt', 'data[*].excerpt_title',
    'data[*].created', 'data[*].updated',
    'data[*].comment_count', 'data[*].like_count',
    'data[*].url', 'data[*].source_pin_id',
  ].join(',');

  const newPins = await fetchAllPages('/pins', headers, {
    include,
    existingSet: null,
    makeItem: item => ({
      date: pinDateStr(item),
      text: extractPinText(item.content),
      images: extractPinMedia(item.content, 'image'),
      links: extractPinMedia(item.content, 'link'),
      comment_count: item.comment_count || 0,
      like_count: item.like_count || 0,
      url: item.url || '',
    }),
  });

  // Merge
  const pinMap = new Map();
  for (const p of existing) pinMap.set(p.url, p);
  for (const p of newPins) { if (p.url) pinMap.set(p.url, p); }

  const allPins = [...pinMap.values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const newCount = allPins.filter(p => !existingUrls.has(p.url)).length;

  saveJSON('zhihu_pins_all.json', allPins);
  console.log(`Pins done: ${allPins.length} total (+${newCount} new, ${allPins.filter(p => p.text).length} with text)`);
  return allPins;
}

// ─── ARTICLES ─────────────────────────────────────────────────────────────────
async function fetchAllArticles(headers) {
  console.log('\n═══════════════════════════════════════');
  console.log('   FETCHING ARTICLES');
  console.log('═══════════════════════════════════════');

  const existing = loadJSON('zhihu_articles_all.json') || [];
  console.log(`Existing: ${existing.length} articles`);
  const existingIds = new Set(existing.filter(a => a.id).map(a => String(a.id)));

  const include = [
    'data[*].title', 'data[*].content', 'data[*].excerpt',
    'data[*].created', 'data[*].updated',
    'data[*].url', 'data[*].voteup_count',
    'data[*].comment_count', 'data[*].image_url',
  ].join(',');

  let upgradedCount = 0;

  const newArts = await fetchAllPages('/articles', headers, {
    include,
    existingSet: existingIds,
    makeItem: item => ({
      id: item.id,
      title: item.title || '',
      excerpt: item.excerpt || '',
      content: item.content || '',
      created: item.created ? new Date(item.created * 1000).toISOString() : '',
      updated: item.updated ? new Date(item.updated * 1000).toISOString() : '',
      url: item.url || '',
      voteup_count: item.voteup_count || 0,
      comment_count: item.comment_count || 0,
      image_url: item.image_url || '',
    }),
    mergeItem: (id, item) => {
      const entry = existing.find(a => String(a.id) === id);
      if (entry && !entry.content && item.content) {
        entry.content = item.content;
        upgradedCount++;
      }
    },
  });

  // Merge
  const artMap = new Map();
  for (const a of existing) artMap.set(String(a.id || a.url || ''), a);
  for (const a of newArts) { const key = String(a.id); if (key) artMap.set(key, a); }

  const allArts = [...artMap.values()];
  const withContent = allArts.filter(a => a.content).length;
  saveJSON('zhihu_articles_all.json', allArts);
  console.log(`Articles done: ${allArts.length} total (${withContent} with content, ${upgradedCount} upgraded)`);
  return allArts;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════');
  console.log('   ZHIHU COMPREHENSIVE DATA ARCHIVAL');
  console.log('   Target: ' + USER_TOKEN);
  console.log('   Working dir: ' + OUT_DIR);
  console.log('═══════════════════════════════════════\n');

  const cookie = getCookie();
  const headers = makeHeaders(cookie);
  console.log(`Cookie: ${cookie.slice(0, 40)}...`);

  // Verify
  console.log('Verifying cookie...');
  const profile = await fetchProfile(headers);
  console.log(`✓ Logged in as: ${profile.name}`);
  console.log(`  Answers: ${profile.answer_count} | Pins: ${profile.pins_count} | Articles: ${profile.articles_count}\n`);

  // Fetch
  let answers = null, pins = null, articles = null;

  if (!SKIP.answers) {
    const t0 = Date.now();
    answers = await fetchAllAnswers(headers);
    console.log(`  Time: ${((Date.now()-t0)/1000).toFixed(0)}s\n`);
  } else {
    answers = loadJSON('zhihu_complete.json');
    console.log('Skipping answers.\n');
  }

  if (!SKIP.pins) {
    const t0 = Date.now();
    pins = await fetchAllPins(headers);
    console.log(`  Time: ${((Date.now()-t0)/1000).toFixed(0)}s\n`);
  } else {
    pins = loadJSON('zhihu_pins_all.json');
    console.log('Skipping pins.\n');
  }

  if (!SKIP.articles) {
    const t0 = Date.now();
    articles = await fetchAllArticles(headers);
    console.log(`  Time: ${((Date.now()-t0)/1000).toFixed(0)}s\n`);
  } else {
    articles = loadJSON('zhihu_articles_all.json');
    console.log('Skipping articles.\n');
  }

  // Summary
  const aTotal = answers?.total || answers?.answers?.length || 0;
  const aContent = answers?.answers?.filter?.(a => a.content)?.length || 0;
  const pTotal = pins?.length || 0;
  const pText = pins?.filter?.(p => p.text)?.length || 0;
  const artTotal = articles?.length || 0;
  const artContent = articles?.filter?.(a => a.content)?.length || 0;

  console.log('═══════════════════════════════════════');
  console.log('   ARCHIVAL COMPLETE');
  console.log('═══════════════════════════════════════');
  console.log(`  Answers:  ${aTotal} (${aContent} with content)`);
  console.log(`  Pins:     ${pTotal} (${pText} with text)`);
  console.log(`  Articles: ${artTotal} (${artContent} with content)`);
  console.log('═══════════════════════════════════════');

  // Summary file
  const summary = [
    `# Zhihu Data Archive`,
    ``,
    `Archived: ${new Date().toISOString().split('T')[0]}`,
    `Target: ${USER_TOKEN}`,
    ``,
    `## Summary`,
    ``,
    `| Type | Count | With Content |`,
    `|------|------:|-------------:|`,
    `| Answers | ${aTotal} | ${aContent} |`,
    `| Pins | ${pTotal} | ${pText} |`,
    `| Articles | ${artTotal} | ${artContent} |`,
    ``,
    `## Files`,
    ``,
    `- \`zhihu_complete.json\` — ${aTotal} answers`,
    `- \`zhihu_pins_all.json\` — ${pTotal} pins`,
    `- \`zhihu_articles_all.json\` — ${artTotal} articles`,
  ].join('\n');
  fs.writeFileSync(`${OUT_DIR}/zhihu_archive_summary.md`, summary, 'utf8');
  console.log(`Summary saved to ${OUT_DIR}/zhihu_archive_summary.md`);
}

main().catch(e => {
  console.error('\nFatal:', e.message);
  console.log('Partial data may have been saved via checkpoints.');
  process.exit(1);
});
