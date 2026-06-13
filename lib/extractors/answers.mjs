import { ANSWERS_INCLUDE } from '../constants.mjs';

export function getAnswersInclude() {
  return ANSWERS_INCLUDE;
}

/**
 * Extract a clean answer object from a raw Zhihu API v4 answer item.
 * question.detail, question.detail_text, and question.topics are left
 * empty — they will be filled later by enricher.mjs.
 * content_html images are left as-is — they will be downloaded and
 * path-rewritten later by media.mjs.
 */
export function extractAnswer(item) {
  const answerId = String(item.id || '');
  const questionId = String(item.question?.id || '');
  return {
    id: answerId,
    url: `https://www.zhihu.com/answer/${answerId}`,
    question: {
      id: questionId,
      url: questionId ? `https://www.zhihu.com/question/${questionId}` : '',
      title: item.question?.title || '',
      detail: '',
      detail_text: '',
      topics: [],
      created: item.question?.created
        ? new Date(item.question.created * 1000).toISOString() : '',
    },
    content_html: item.content || '',
    excerpt: item.excerpt || '',
    voteup_count: item.voteup_count ?? item.reaction?.statistics?.like_count ?? 0,
    comment_count: item.comment_count ?? 0,
    collect_count: item.collect_count ?? item.favorite_count ?? item.reaction?.statistics?.favorites ?? 0,
    created: item.created_time
      ? new Date(item.created_time * 1000).toISOString() : '',
    images: [],
  };
}

/**
 * Merge updated API data into an existing answer entry.
 * Upgrades content if existing entry lacks it, and refreshes counts.
 * Returns true if the entry was modified.
 */
export function mergeAnswer(existing, item) {
  let changed = false;
  const answerId = String(item.id || '');
  const questionId = String(item.question?.id || '');
  const content = item.content || '';
  const excerpt = item.excerpt || '';
  const votes = item.voteup_count ?? item.reaction?.statistics?.like_count;
  const comments = item.comment_count;
  const collects = item.collect_count ?? item.favorite_count ?? item.reaction?.statistics?.favorites;

  if (!existing.url && answerId) {
    existing.url = `https://www.zhihu.com/answer/${answerId}`; changed = true;
  }
  if (!existing.question?.url && questionId) {
    existing.question.url = `https://www.zhihu.com/question/${questionId}`; changed = true;
  }

  if (!existing.content_html && content) {
    existing.content_html = content; changed = true;
  }
  if (!existing.excerpt && excerpt) {
    existing.excerpt = excerpt; changed = true;
  }
  if (votes !== undefined && votes !== null && votes > (existing.voteup_count || 0)) {
    existing.voteup_count = votes; changed = true;
  }
  if (comments !== undefined && comments !== null && comments > (existing.comment_count || 0)) {
    existing.comment_count = comments; changed = true;
  }
  if (collects !== undefined && collects !== null && collects > (existing.collect_count || 0)) {
    existing.collect_count = collects; changed = true;
  }
  return changed;
}
