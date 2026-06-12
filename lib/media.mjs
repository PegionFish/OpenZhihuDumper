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
 *  2. Remove /50/ avatar/thumbnail path prefix
 *  3. Remove size suffix between hash and extension
 *
 * Example:
 *   In:  https://pic3.zhimg.com/50/v2-d706321_qhd.jpg?source=e3d01f54
 *   Out: https://pic3.zhimg.com/v2-d706321.jpg
 */
function resolveOriginalUrl(url) {
  if (!url) return url;
  // Step 1: strip query string
  let cleaned = url.split('?')[0];
  // Step 2: remove /50/ thumbnail prefix
  cleaned = cleaned.replace(/(\/pic\w\.zhimg\.com)\/50\//, '$1/');
  // Step 3: remove known size suffix (appears before extension)
  for (const suffix of SIZE_SUFFIXES) {
    const re = new RegExp(suffix + '(\\.[a-z]+)$', 'i');
    if (re.test(cleaned)) {
      cleaned = cleaned.replace(re, '$1');
      break;
    }
  }
  return cleaned;
}

/**
 * Download all images referenced in HTML, rewrite src to local paths.
 *
 * @param {string} html - HTML content containing img tags
 * @param {string} itemId - unique ID (e.g. answer/3285770022)
 * @param {string} itemType - 'answer' | 'pin' | 'article'
 * @param {string} outDir - base output directory
 * @param {number} [concurrency=5] - max simultaneous downloads
 * @returns {Promise<{html: string, manifest: Array}>}
 */
export async function downloadImages(html, itemId, itemType, outDir, concurrency = IMAGE_CONCURRENCY) {
  if (!html) return { html, manifest: [] };
  const $ = load(html);
  const imgDir = path.join(outDir, 'images', `${itemType}_${itemId}`);
  const manifest = [];
  const urlMap = new Map(); // full-resolution URL → local filename (dedup)

  // Collect all img tags
  const imgs = [];
  $('img').each((i, el) => {
    const thumbSrc = $(el).attr('data-actualsrc') ||
                     $(el).attr('data-original') ||
                     $(el).attr('src');
    if (!thumbSrc || thumbSrc.startsWith('data:')) return;
    // Skip tracking/analytics pixels
    if (thumbSrc.includes('zhihu.com/equation')) return;
    const fullSrc = resolveOriginalUrl(thumbSrc);
    imgs.push({ el, thumbSrc, fullSrc });
  });

  // Dedup and prepare download list
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

  // Ensure output directory exists
  fs.mkdirSync(imgDir, { recursive: true });

  // Download with concurrency limit using a worker pool
  const queue = [...downloads];
  async function worker() {
    while (queue.length > 0) {
      const { el, thumbSrc, fullSrc, filename } = queue.shift();
      const dest = path.join(imgDir, filename);
      try {
        // Try full-resolution URL first
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
