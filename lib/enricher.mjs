import { load } from 'cheerio';
import { makeHeaders } from './constants.mjs';

/**
 * Fetch the question HTML page and extract detail + topics.
 * Uses cheerio to parse the page — no WBI/x-zse-96 signature needed.
 *
 * On any error (403, timeout, captcha, parse failure) returns empty defaults
 * silently — enrichment is best-effort.
 *
 * @returns {Promise<{detail: string, detail_text: string, topics: Array}>}
 */
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
    $('.QuestionHeader-topics .TopicLink, .QuestionTopic .Popover div, .TopicLink').each((i, el) => {
      const href = $(el).attr('href') || $(el).find('a').attr('href') || '';
      const name = $(el).text().trim();
      const id = href.split('/').pop();
      if (name && id) topics.push({ id, name });
    });

    // Deduplicate topics by id
    const seen = new Set();
    const unique = topics.filter(t => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });

    return { detail, detail_text, topics: unique };
  } catch {
    return { detail: '', detail_text: '', topics: [] };
  }
}

/**
 * Fetch the article HTML page and extract column + topics.
 *
 * On any error returns empty defaults silently.
 *
 * @returns {Promise<{column: object|null, topics: Array}>}
 */
export async function enrichArticle(articleSlug, cookie, userToken) {
  try {
    const url = `https://zhuanlan.zhihu.com/p/${articleSlug}`;
    const resp = await fetch(url, { headers: makeHeaders(cookie, userToken) });
    if (!resp.ok) return { column: null, topics: [] };
    const html = await resp.text();
    const $ = load(html);

    const columnEl = $('.ColumnLink').first();
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
