import fs from 'fs';
import {
  PER_PAGE, REQUEST_DELAY, MAX_RETRIES, CKPT_INTERVAL,
  OUT_DIR, makeHeaders, API,
} from './constants.mjs';

// ─── Utilities ──────────────────────────────────────────────────────────
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── JSON File I/O ──────────────────────────────────────────────────────
export function loadJSON(file, outDir = OUT_DIR) {
  const fpath = `${outDir}/${file}`;
  try { return JSON.parse(fs.readFileSync(fpath, 'utf8')); } catch { return null; }
}

export function saveJSON(file, data, outDir = OUT_DIR) {
  const fpath = `${outDir}/${file}`;
  fs.writeFileSync(fpath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`  ✓ Saved ${fpath}`);
}

// ─── Rate-limited fetch with retry ──────────────────────────────────────
export async function fetchJSON(url, headers, retries = MAX_RETRIES) {
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

// ─── Profile ────────────────────────────────────────────────────────────
export async function fetchProfile(token, cookie) {
  const headers = makeHeaders(cookie, token);
  return fetchJSON(API.PROFILE(token), headers);
}

// ─── Paginated fetch with checkpoint saves ──────────────────────────────
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

    let addedThisPage = 0;
    for (const item of items) {
      const key = String(item.id || item.url || '');
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
    process.stdout.write(`\r  Page ${page + 1}: +${allItems.length} new (total: ${total})`);

    // Checkpoint save
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
