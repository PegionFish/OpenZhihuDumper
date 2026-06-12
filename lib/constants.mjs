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

// Include parameters — verified against live API v4 responses
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
