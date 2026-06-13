import { PINS_INCLUDE } from '../constants.mjs';

export function getPinsInclude() {
  return PINS_INCLUDE;
}

function normalizePinUrl(url) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return `https://www.zhihu.com${url}`;
}

/**
 * Render an array of content blocks into a single HTML string.
 * Content blocks come from the Zhihu API with types: text, image, link, video.
 * The extractor MUST NOT strip HTML from text blocks — they may contain
 * &lt;img class="content-emoji"&gt;, &lt;a&gt;, &lt;br&gt; etc.
 */
export function renderContentBlocks(blocks) {
  if (!blocks || !Array.isArray(blocks)) return '';
  return blocks.map(block => {
    switch (block.type) {
      case 'text':
        return `<p>${block.content || block.own_text || ''}</p>`;
      case 'image':
        return `<img src="${block.content?.url || ''}" alt="">`;
      case 'link':
        return `<a href="${block.content?.url || ''}">${block.content?.title || ''}</a>`;
      case 'video':
        return `<video src="${block.content?.url || ''}" poster="${block.content?.cover || ''}"></video>`;
      case 'link_card':
        return block.content?.url
          ? `<a href="${block.content.url}">${block.content.title || block.content.url}</a>`
          : '';
      default:
        return '';
    }
  }).join('\n');
}

/**
 * Extract author info from a pin repost chain sub-object.
 */
export function extractPinAuthor(raw) {
  if (!raw) return null;
  return {
    name: raw.name || '',
    url_token: raw.url_token || '',
    avatar_url: raw.avatar_url || '',
  };
}

/**
 * Partial extraction for repin/origin_pin nested objects.
 * These contain author + content but not the full pin metadata.
 */
export function extractPinPartial(raw) {
  if (!raw) return null;
  return {
    author: extractPinAuthor(raw.author),
    content_html: renderContentBlocks(raw.content),
    url: normalizePinUrl(raw.url),
    created: raw.created ? new Date(raw.created * 1000).toISOString() : '',
    like_count: raw.like_count || 0,
    comment_count: raw.comment_count || 0,
  };
}

/**
 * Extract a full pin from a raw API v4 pin item.
 * Preserves repin and origin_pin repost chains recursively.
 */
export function extractPin(item) {
  return {
    id: String(item.id),
    type: item.type || 'pin',
    url: normalizePinUrl(item.url),
    created: item.created ? new Date(item.created * 1000).toISOString() : '',
    content_html: renderContentBlocks(item.content),
    excerpt_title: item.excerpt_title || '',
    repin: item.repin ? extractPinPartial(item.repin) : null,
    origin_pin: item.origin_pin ? extractPinPartial(item.origin_pin) : null,
    like_count: item.like_count || 0,
    comment_count: item.comment_count || 0,
    images: [],
  };
}
