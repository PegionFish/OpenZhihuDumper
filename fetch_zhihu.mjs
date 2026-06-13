#!/usr/bin/env node
// Zhihu Data Archival Tool v2.0.0 — Rich content preservation
//
// Usage:
//   node fetch_zhihu.mjs --token=<url_token> [--cookie="..."] [flags]
//
//   --token=<url_token>      (Required) Target user's Zhihu url_token
//   --cookie="..."           Cookie header string for auth
//   --skip-answers           Skip answers fetch
//   --skip-pins              Skip pins fetch
//   --skip-articles          Skip articles fetch
//   --no-images              Skip image download (keep URLs)
//   --no-markdown            Skip Markdown generation (JSON only)
//   --no-enrich              Skip HTML page scraping for details/topics/columns
//   --out-dir=<path>         Output directory (default: .)
//   --concurrency=<n>        Image download concurrency (default: 5)

import fs from 'fs';
import path from 'path';
import {
  OUT_DIR, API, CKPT_INTERVAL,
} from './lib/constants.mjs';
import {
  sleep, loadJSON, saveJSON, fetchProfile, fetchAllPages,
} from './lib/fetcher.mjs';
import {
  getAnswersInclude, extractAnswer, mergeAnswer,
} from './lib/extractors/answers.mjs';
import {
  getPinsInclude, extractPin,
} from './lib/extractors/pins.mjs';
import {
  getArticlesInclude, extractArticle, mergeArticle,
} from './lib/extractors/articles.mjs';
import { downloadImages, createImageLogger } from './lib/media.mjs';
import { exportMarkdown } from './lib/exporter.mjs';
import { enrichQuestion, enrichArticle } from './lib/enricher.mjs';

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
  answers:  process.argv.includes('--skip-answers'),
  pins:     process.argv.includes('--skip-pins'),
  articles: process.argv.includes('--skip-articles'),
};
const NO_IMAGES   = process.argv.includes('--no-images');
const NO_MARKDOWN = process.argv.includes('--no-markdown');
const NO_ENRICH   = process.argv.includes('--no-enrich');
const OUT_DIR_CLI = getArg('--out-dir=') || OUT_DIR;
const CONCURRENCY = parseInt(getArg('--concurrency=') || '5', 10);

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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildCrossReferences(answers, pins, articles) {
  const refs = { questions: {}, topic_index: {}, pin_reposts: {} };

  // Questions → answers
  if (answers?.answers) {
    for (const a of answers.answers) {
      const qid = a.question?.id;
      if (!qid) continue;
      if (!refs.questions[qid]) {
        refs.questions[qid] = {
          id: qid,
          title: a.question.title || '',
          answered_by: [],
          topics: a.question.topics || [],
        };
      }
      refs.questions[qid].answered_by.push(a.id);

      // Topic index
      for (const t of (a.question.topics || [])) {
        if (!refs.topic_index[t.id]) refs.topic_index[t.id] = { name: t.name, answers: [], articles: [], pins: [] };
        if (!refs.topic_index[t.id].answers.includes(a.id)) refs.topic_index[t.id].answers.push(a.id);
      }
    }
  }

  // Articles → topic index
  if (articles?.length) {
    for (const a of articles) {
      for (const t of (a.topics || [])) {
        if (!refs.topic_index[t.id]) refs.topic_index[t.id] = { name: t.name, answers: [], articles: [], pins: [] };
        if (!refs.topic_index[t.id].articles.includes(a.id)) refs.topic_index[t.id].articles.push(a.id);
      }
    }
  }

  // Pin repost chains
  if (pins?.length) {
    for (const p of pins) {
      if (p.origin_pin?.url) {
        const originId = p.origin_pin.url.split('/').pop();
        if (!refs.pin_reposts[originId]) refs.pin_reposts[originId] = [];
        refs.pin_reposts[originId].push(p.id);
      }
      if (p.repin?.url) {
        const repinId = p.repin.url.split('/').pop();
        if (!refs.pin_reposts[repinId]) refs.pin_reposts[repinId] = [];
        refs.pin_reposts[repinId].push(p.id);
      }
    }
  }

  return refs;
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function writeImageLogs(imageLogs, outDir) {
  if (!imageLogs.length) return;
  const logsDir = path.join(outDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const ts = timestampForFilename();

  const fullLog = imageLogs.map(item => ({
    itemType: item.itemType,
    itemId: item.itemId,
    total: item.total,
    success: item.success,
    skipped: item.skipped,
    fallback: item.fallback,
    failed: item.failed,
    images: item.images.map(img => ({
      url: img.full_resolution || img.original,
      status: img.failed ? 'failed' : img.fallback ? 'fallback' : img.skipped ? 'skipped' : 'success',
      local: img.local || null,
      error: img.failed ? 'download failed' : undefined,
    })),
  }));

  fs.writeFileSync(path.join(logsDir, `image_download_${ts}.json`), JSON.stringify(fullLog, null, 2), 'utf8');

  const failedList = imageLogs.flatMap(item =>
    item.images
      .filter(img => img.failed)
      .map(img => ({
        itemType: item.itemType,
        itemId: item.itemId,
        url: img.full_resolution || img.original,
      }))
  );

  fs.writeFileSync(path.join(logsDir, `images_failed_${ts}.json`), JSON.stringify(failedList, null, 2), 'utf8');
}

// ─── Answers ──────────────────────────────────────────────────────────────────
async function fetchAnswers(cookie, profile) {
  console.log('\n═══════════════════════════════════════');
  console.log('   FETCHING ANSWERS');
  console.log('═══════════════════════════════════════');

  const existing = loadJSON('zhihu_complete.json', OUT_DIR_CLI);
  const existingMap = new Map();
  for (const a of (existing?.answers || [])) {
    if (!a) continue;
    // Legacy archives stored `question` as just the title string.
    if (typeof a.question === 'string') {
      a.question = {
        id: '', url: '', title: a.question,
        detail: '', detail_text: '', topics: [], created: '',
      };
    } else if (!a.question) {
      a.question = {
        id: '', url: '', title: '',
        detail: '', detail_text: '', topics: [], created: '',
      };
    }
    existingMap.set(String(a.id || ''), a);
  }
  console.log(`Existing: ${existingMap.size} answers (${[...existingMap.values()].filter(a => a.content_html).length} with content)`);

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
      finalizeAnswers(merged, 0, profile);
    },
  });

  for (const a of newItems) {
    if (!existingMap.has(a.id)) existingMap.set(a.id, a);
  }

  console.log(`  New this run: ${newItems.length}, upgraded: ${upgradedCount}`);

  // Enrich questions
  if (!NO_ENRICH) {
    console.log('\nEnriching question details (HTML page scrape)...');
    const allAnswers = [...existingMap.values()];
    const questionsToEnrich = [...new Set(allAnswers.filter(a => !a.question.detail).map(a => a.question.id))];
    let enriched = 0;
    for (let i = 0; i < questionsToEnrich.length; i++) {
      const qid = questionsToEnrich[i];
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
        process.stdout.write(`\r  Enriched ${enriched}/${i + 1} questions`);
      }
      if (i < questionsToEnrich.length - 1) await sleep(500); // polite delay
    }
    console.log(`\n  Enriched ${enriched}/${questionsToEnrich.length} questions`);
  }

  // Download images
  const imageLogs = [];
  if (!NO_IMAGES) {
    console.log('\nDownloading answer images...');
    let imgCount = 0, skipCount = 0, fallbackCount = 0, failCount = 0, total = 0;
    for (const a of existingMap.values()) {
      if (a.content_html) {
        total++;
        const result = await downloadImages(a.content_html, a.id, 'answer', OUT_DIR_CLI, CONCURRENCY, createImageLogger('answer', a.id));
        a.content_html = result.html;
        a.images = result.manifest;
        const success = result.manifest.filter(m => !m.failed && !m.fallback && !m.skipped).length;
        const skipped = result.manifest.filter(m => m.skipped).length;
        const fallback = result.manifest.filter(m => m.fallback).length;
        const failed = result.manifest.filter(m => m.failed).length;
        imgCount += success;
        skipCount += skipped;
        fallbackCount += fallback;
        failCount += failed;
        imageLogs.push({ itemType: 'answer', itemId: a.id, total: result.manifest.length, success, skipped, fallback, failed, images: result.manifest });
      }
    }
    console.log(`  图片：${imgCount} 下载成功，${skipCount} 跳过，${fallbackCount} 降级，${failCount} 失败（共 ${imgCount + skipCount + fallbackCount + failCount} 张）`);
  }

  const result = finalizeAnswers(existingMap, upgradedCount, profile);
  return { ...result, imageLogs };
}

function finalizeAnswers(answerMap, upgradedCount, profile) {
  const answers = [...answerMap.values()].sort(
    (a, b) => new Date(a.created || 0) - new Date(b.created || 0)
  );
  const years = {};
  for (const a of answers) {
    const y = new Date(a.created || 0).getFullYear();
    if (y > 2000) years[y] = (years[y] || 0) + 1;
  }
  const totalVotes = answers.reduce((s, a) => s + (a.voteup_count || 0), 0);
  const withContent = answers.filter(a => a.content_html).length;

  const result = {
    profile: profile ? {
      name: profile.name || '',
      url_token: profile.url_token || USER_TOKEN,
      answer_count: profile.answer_count ?? 0,
      pins_count: profile.pins_count ?? 0,
      articles_count: profile.articles_count ?? 0,
      follower_count: profile.follower_count ?? 0,
    } : undefined,
    total: answers.length,
    total_votes: totalVotes,
    years,
    answers,
  };
  saveJSON('zhihu_complete.json', result, OUT_DIR_CLI);
  const yStr = Object.entries(years).sort(([a],[b])=>a-b).map(([y,c])=>`${y}:${c}`).join(', ');
  console.log(`Answers done: ${answers.length} total (${withContent} with content) [${yStr}]`);
  if (upgradedCount) console.log(`  (${upgradedCount} existing entries upgraded)`);
  return result;
}

// ─── Pins ─────────────────────────────────────────────────────────────────────
async function fetchPins(cookie) {
  console.log('\n═══════════════════════════════════════');
  console.log('   FETCHING PINS (想法)');
  console.log('═══════════════════════════════════════');

  const existing = loadJSON('zhihu_pins_all.json', OUT_DIR_CLI) || [];
  console.log(`Existing: ${existing.length} pins`);
  const existingUrls = new Set(existing.filter(p => p.url).map(p => p.url));

  const newPins = await fetchAllPages('PINS', USER_TOKEN, cookie, {
    include: getPinsInclude(),
    existingSet: null,
    makeItem: extractPin,
  });

  // Merge
  const pinMap = new Map();
  for (const p of existing) pinMap.set(p.url, p);
  for (const p of newPins) { if (p.url) pinMap.set(p.url, p); }

  const allPins = [...pinMap.values()].sort((a, b) => (b.created || '').localeCompare(a.created || ''));

  // Download images
  const imageLogs = [];
  if (!NO_IMAGES) {
    console.log('\nDownloading pin images...');
    let imgCount = 0, skipCount = 0, fallbackCount = 0, failCount = 0;
    for (const p of allPins) {
      if (p.content_html) {
        const result = await downloadImages(p.content_html, p.id, 'pin', OUT_DIR_CLI, CONCURRENCY, createImageLogger('pin', p.id));
        p.content_html = result.html;
        p.images = result.manifest;
        const success = result.manifest.filter(m => !m.failed && !m.fallback && !m.skipped).length;
        const skipped = result.manifest.filter(m => m.skipped).length;
        const fallback = result.manifest.filter(m => m.fallback).length;
        const failed = result.manifest.filter(m => m.failed).length;
        imgCount += success;
        skipCount += skipped;
        fallbackCount += fallback;
        failCount += failed;
        imageLogs.push({ itemType: 'pin', itemId: p.id, total: result.manifest.length, success, skipped, fallback, failed, images: result.manifest });
      }
      // Also download images in repin/origin_pin chains
      for (const key of ['repin', 'origin_pin']) {
        if (p[key]?.content_html) {
          const result = await downloadImages(p[key].content_html, `${p.id}_${key}`, 'pin', OUT_DIR_CLI, CONCURRENCY, createImageLogger('pin', `${p.id}_${key}`));
          p[key].content_html = result.html;
          const success = result.manifest.filter(m => !m.failed && !m.fallback && !m.skipped).length;
          const skipped = result.manifest.filter(m => m.skipped).length;
          const fallback = result.manifest.filter(m => m.fallback).length;
          const failed = result.manifest.filter(m => m.failed).length;
          imgCount += success;
          skipCount += skipped;
          fallbackCount += fallback;
          failCount += failed;
          imageLogs.push({ itemType: 'pin', itemId: `${p.id}_${key}`, total: result.manifest.length, success, skipped, fallback, failed, images: result.manifest });
        }
      }
    }
    console.log(`  图片：${imgCount} 下载成功，${skipCount} 跳过，${fallbackCount} 降级，${failCount} 失败（共 ${imgCount + skipCount + fallbackCount + failCount} 张）`);
  }

  const withText = allPins.filter(p => p.content_html).length;
  const newCount = allPins.filter(p => !existingUrls.has(p.url)).length;
  saveJSON('zhihu_pins_all.json', allPins, OUT_DIR_CLI);
  console.log(`Pins done: ${allPins.length} total (+${newCount} new, ${withText} with content)`);
  return { pins: allPins, imageLogs };
}

// ─── Articles ─────────────────────────────────────────────────────────────────
async function fetchArticles(cookie) {
  console.log('\n═══════════════════════════════════════');
  console.log('   FETCHING ARTICLES');
  console.log('═══════════════════════════════════════');

  const existing = loadJSON('zhihu_articles_all.json', OUT_DIR_CLI) || [];
  console.log(`Existing: ${existing.length} articles`);
  const existingIds = new Set(existing.filter(a => a.id).map(a => String(a.id)));
  let upgradedCount = 0;

  const newArts = await fetchAllPages('ARTICLES', USER_TOKEN, cookie, {
    include: getArticlesInclude(),
    existingSet: existingIds,
    makeItem: extractArticle,
    mergeItem: (id, item) => {
      const entry = existing.find(a => String(a.id) === id);
      if (entry && mergeArticle(entry, item)) upgradedCount++;
    },
  });

  // Merge
  const artMap = new Map();
  for (const a of existing) artMap.set(String(a.id), a);
  for (const a of newArts) { const key = String(a.id); if (key) artMap.set(key, a); }
  const allArts = [...artMap.values()];

  // Enrich
  if (!NO_ENRICH) {
    console.log('\nEnriching article columns/topics (HTML page scrape)...');
    let enriched = 0;
    for (const a of allArts) {
      if (a.column && a.topics.length > 0) continue; // already enriched
      if (!a.id) continue;
      const data = await enrichArticle(a.id, cookie, USER_TOKEN);
      if (data.column) { a.column = data.column; enriched++; }
      if (data.topics.length > 0) { a.topics = data.topics; }
      await sleep(500);
    }
    console.log(`  Enriched ${enriched}/${allArts.length} articles`);
  }

  // Download images
  const imageLogs = [];
  if (!NO_IMAGES) {
    console.log('\nDownloading article images...');
    let imgCount = 0, skipCount = 0, fallbackCount = 0, failCount = 0;
    for (const a of allArts) {
      if (a.content_html) {
        const result = await downloadImages(a.content_html, a.id, 'article', OUT_DIR_CLI, CONCURRENCY, createImageLogger('article', a.id));
        a.content_html = result.html;
        a.images = result.manifest;
        const success = result.manifest.filter(m => !m.failed && !m.fallback && !m.skipped).length;
        const skipped = result.manifest.filter(m => m.skipped).length;
        const fallback = result.manifest.filter(m => m.fallback).length;
        const failed = result.manifest.filter(m => m.failed).length;
        imgCount += success;
        skipCount += skipped;
        fallbackCount += fallback;
        failCount += failed;
        imageLogs.push({ itemType: 'article', itemId: a.id, total: result.manifest.length, success, skipped, fallback, failed, images: result.manifest });
      }
      // Cover image
      if (a.image_url) {
        const result = await downloadImages(`<img src="${a.image_url}">`, a.id, 'article', OUT_DIR_CLI, CONCURRENCY, createImageLogger('article', `${a.id}_cover`));
        if (result.manifest.length > 0 && !result.manifest[0].failed) {
          a.image_url = result.manifest[0].local;
          a.images = a.images || [];
          a.images.push(result.manifest[0]);
          imgCount++;
          imageLogs.push({ itemType: 'article', itemId: `${a.id}_cover`, total: 1, success: 1, skipped: 0, fallback: 0, failed: 0, images: result.manifest });
        } else if (result.manifest.length > 0 && result.manifest[0].failed) {
          failCount++;
          imageLogs.push({ itemType: 'article', itemId: `${a.id}_cover`, total: 1, success: 0, skipped: 0, fallback: 0, failed: 1, images: result.manifest });
        }
      }
    }
    console.log(`  图片：${imgCount} 下载成功，${skipCount} 跳过，${fallbackCount} 降级，${failCount} 失败（共 ${imgCount + skipCount + fallbackCount + failCount} 张）`);
  }

  const withContent = allArts.filter(a => a.content_html).length;
  saveJSON('zhihu_articles_all.json', allArts, OUT_DIR_CLI);
  console.log(`Articles done: ${allArts.length} total (${withContent} with content, ${upgradedCount} upgraded)`);
  return { articles: allArts, imageLogs };
}

// ─── Summary ──────────────────────────────────────────────────────────────────
function writeSummary(answers, pins, articles, profile) {
  const aTotal = answers?.total || answers?.answers?.length || 0;
  const aContent = answers?.answers?.filter?.(a => a.content_html)?.length || 0;
  const pTotal = pins?.length || 0;
  const pText = pins?.filter?.(p => p.content_html)?.length || 0;
  const artTotal = articles?.length || 0;
  const artContent = articles?.filter?.(a => a.content_html)?.length || 0;

  console.log('\n═══════════════════════════════════════');
  console.log('   ARCHIVAL COMPLETE');
  console.log('═══════════════════════════════════════');
  console.log(`  Answers:  ${aTotal} (${aContent} with content)`);
  console.log(`  Pins:     ${pTotal} (${pText} with content)`);
  console.log(`  Articles: ${artTotal} (${artContent} with content)`);
  console.log('═══════════════════════════════════════');

  const summary = [
    '# Zhihu Data Archive',
    '',
    `Archived: ${new Date().toISOString().split('T')[0]}`,
    `Target: ${USER_TOKEN}`,
    profile ? `Name: ${profile.name}` : '',
    '',
    '## Summary',
    '',
    '| Type | Count | With Content |',
    '|------|------:|-------------:|',
    `| Answers | ${aTotal} | ${aContent} |`,
    `| Pins | ${pTotal} | ${pText} |`,
    `| Articles | ${artTotal} | ${artContent} |`,
    '',
    '## Files',
    '',
    '- `zhihu_complete.json` — all answers',
    '- `zhihu_pins_all.json` — all pins',
    '- `zhihu_articles_all.json` — all articles',
    '- `zhihu_references.json` — cross-reference index',
    NO_IMAGES ? '' : '- `images/` — downloaded images',
    NO_MARKDOWN ? '' : '- `markdown/` — rendered Markdown files',
  ].filter(Boolean).join('\n');
  fs.writeFileSync(`${OUT_DIR_CLI}/zhihu_archive_summary.md`, summary, 'utf8');
  console.log(`Summary saved to ${OUT_DIR_CLI}/zhihu_archive_summary.md`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════');
  console.log('   ZHIHU DATA ARCHIVAL v2.0.0');
  console.log('   Target: ' + USER_TOKEN);
  console.log('   Output: ' + OUT_DIR_CLI);
  console.log('═══════════════════════════════════════\n');

  const cookie = getCookie();
  console.log(`Cookie: ${cookie.slice(0, 40)}...`);

  // Ensure output directory exists
  fs.mkdirSync(OUT_DIR_CLI, { recursive: true });

  // Verify
  console.log('Verifying cookie...');
  const profile = await fetchProfile(USER_TOKEN, cookie);
  console.log(`✓ Logged in as: ${profile.name}`);
  console.log(`  Answers: ${profile.answer_count} | Pins: ${profile.pins_count} | Articles: ${profile.articles_count}\n`);

  let answers = null, pins = null, articles = null;
  let answerLogs = [], pinLogs = [], articleLogs = [];

  if (!SKIP.answers) {
    const t0 = Date.now();
    const answerResult = await fetchAnswers(cookie, profile);
    answers = answerResult;
    answerLogs = answerResult.imageLogs || [];
    console.log(`  Time: ${((Date.now()-t0)/1000).toFixed(0)}s\n`);
  } else {
    answers = loadJSON('zhihu_complete.json', OUT_DIR_CLI);
    if (answers) answers.profile = answers.profile || {
      name: profile.name, url_token: USER_TOKEN,
      answer_count: profile.answer_count, pins_count: profile.pins_count,
      articles_count: profile.articles_count, follower_count: profile.follower_count,
    };
    console.log('Skipping answers.\n');
  }

  if (!SKIP.pins) {
    const t0 = Date.now();
    const pinResult = await fetchPins(cookie);
    pins = pinResult.pins;
    pinLogs = pinResult.imageLogs || [];
    console.log(`  Time: ${((Date.now()-t0)/1000).toFixed(0)}s\n`);
  } else {
    pins = loadJSON('zhihu_pins_all.json', OUT_DIR_CLI) || [];
    console.log('Skipping pins.\n');
  }

  if (!SKIP.articles) {
    const t0 = Date.now();
    const articleResult = await fetchArticles(cookie);
    articles = articleResult.articles;
    articleLogs = articleResult.imageLogs || [];
    console.log(`  Time: ${((Date.now()-t0)/1000).toFixed(0)}s\n`);
  } else {
    articles = loadJSON('zhihu_articles_all.json', OUT_DIR_CLI) || [];
    console.log('Skipping articles.\n');
  }

  // Cross-reference index
  const refs = buildCrossReferences(answers, pins, articles);
  saveJSON('zhihu_references.json', refs, OUT_DIR_CLI);

  // Persist image download logs
  writeImageLogs([...answerLogs, ...pinLogs, ...articleLogs], OUT_DIR_CLI);

  // Markdown
  if (!NO_MARKDOWN) {
    console.log('\nGenerating Markdown...');
    const mdProfile = { name: profile.name };
    const answersObj = answers?.answers ? { profile: { ...mdProfile, ...(answers.profile||{}) }, answers: answers.answers, years: answers.years, total: answers.total } : null;
    await exportMarkdown(answersObj, pins, articles, OUT_DIR_CLI);
    console.log('  Markdown exported.');
  }

  // Summary
  writeSummary(answers, pins, articles, profile);
}

main().catch(e => {
  console.error('\nFatal:', e.message);
  console.error(e.stack);
  console.log('Partial data may have been saved via checkpoints.');
  process.exit(1);
});
