import { ARTICLES_INCLUDE } from '../constants.mjs';

export function getArticlesInclude() {
  return ARTICLES_INCLUDE;
}

/**
 * Extract a clean article object from a raw Zhihu API v4 article item.
 * column and topics are left empty — they will be filled later by enricher.mjs.
 * image_url images are left as-is — they will be downloaded later by media.mjs.
 */
export function extractArticle(item) {
  return {
    id: String(item.id),
    title: item.title || '',
    content_html: item.content || '',
    excerpt: item.excerpt || '',
    column: null,
    topics: [],
    image_url: item.image_url || '',
    voteup_count: item.voteup_count ?? item.reaction?.statistics?.like_count ?? 0,
    comment_count: item.comment_count ?? 0,
    created: item.created ? new Date(item.created * 1000).toISOString() : '',
    updated: item.updated ? new Date(item.updated * 1000).toISOString() : '',
    url: item.url || '',
    images: [],
  };
}

/**
 * Merge updated API data into an existing article entry.
 * Upgrades content if existing entry lacks it.
 * Returns true if the entry was modified.
 */
export function mergeArticle(existing, item) {
  let changed = false;
  if (!existing.content_html && item.content) {
    existing.content_html = item.content; changed = true;
  }
  if (!existing.excerpt && item.excerpt) {
    existing.excerpt = item.excerpt; changed = true;
  }
  if (item.voteup_count !== undefined && item.voteup_count !== null && item.voteup_count > (existing.voteup_count || 0)) {
    existing.voteup_count = item.voteup_count; changed = true;
  } else if (item.reaction?.statistics?.like_count !== undefined && item.reaction.statistics.like_count > (existing.voteup_count || 0)) {
    existing.voteup_count = item.reaction.statistics.like_count; changed = true;
  }
  if (item.comment_count !== undefined && item.comment_count !== null && item.comment_count > (existing.comment_count || 0)) {
    existing.comment_count = item.comment_count; changed = true;
  }
  return changed;
}
