import fs from 'fs';
import path from 'path';
import TurndownService from 'turndown';
import { OUT_DIR } from './constants.mjs';

// ─── JSON File I/O ──────────────────────────────────────────────────────
export function saveJSON(file, data, outDir = OUT_DIR) {
  const fpath = path.join(outDir, file);
  fs.writeFileSync(fpath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`  ✓ Saved ${fpath}`);
}

export function loadJSON(file, outDir = OUT_DIR) {
  const fpath = path.join(outDir, file);
  try { return JSON.parse(fs.readFileSync(fpath, 'utf8')); } catch { return null; }
}

// ─── Turndown Service ───────────────────────────────────────────────────
function createTurndownService() {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });

  // Custom rule: keep emoji images as inline markdown images
  td.addRule('content-emoji', {
    filter: (node) => {
      if (node.tagName !== 'IMG') return false;
      const cls = node.getAttribute('class') || '';
      return cls.includes('content-emoji') || cls.includes('emoji');
    },
    replacement: (content, node) => {
      const src = node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') || 'emoji';
      return `![${alt}](${src})`;
    },
  });

  return td;
}

const td = createTurndownService();

// ─── Markdown Export ────────────────────────────────────────────────────
/**
 * Generate a markdown file tree from the archived data.
 *
 * @param {object} answers - { profile, answers[] }
 * @param {array}  pins
 * @param {array}  articles
 * @param {string} outDir
 */
export async function exportMarkdown(answers, pins, articles, outDir) {
  const base = path.join(outDir, 'markdown');

  const profileName = answers?.profile?.name || 'Unknown';

  // Answers
  if (answers?.answers?.length) {
    for (const a of answers.answers) {
      const dir = answerDir(a, base);
      fs.mkdirSync(dir, { recursive: true });
      const md = answerMarkdown(a);
      fs.writeFileSync(path.join(dir, `${a.id}.md`), md, 'utf8');
    }
    console.log(`  Exported ${answers.answers.length} answer markdown files`);
  }

  // Pins
  if (pins?.length) {
    for (const p of pins) {
      const dir = dateDir(p.created, base, 'pins');
      fs.mkdirSync(dir, { recursive: true });
      const md = pinMarkdown(p);
      fs.writeFileSync(path.join(dir, `${p.id}.md`), md, 'utf8');
    }
    console.log(`  Exported ${pins.length} pin markdown files`);
  }

  // Articles
  if (articles?.length) {
    for (const a of articles) {
      const dir = dateDir(a.created, base, 'articles');
      fs.mkdirSync(dir, { recursive: true });
      const md = articleMarkdown(a);
      fs.writeFileSync(path.join(dir, `${a.id}.md`), md, 'utf8');
    }
    console.log(`  Exported ${articles.length} article markdown files`);
  }

  // Index
  const idx = indexMarkdown(profileName, answers, pins, articles);
  fs.writeFileSync(path.join(base, 'index.md'), idx, 'utf8');
  console.log(`  ✓ Saved ${path.join(base, 'index.md')}`);
}

// ─── Date Helpers ───────────────────────────────────────────────────────
function dateParts(isoString) {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return { year: 'unknown', month: '00' };
    return {
      year: String(d.getFullYear()),
      month: String(d.getMonth() + 1).padStart(2, '0'),
    };
  } catch {
    return { year: 'unknown', month: '00' };
  }
}

function dateDir(iso, base, type) {
  const { year, month } = dateParts(iso);
  return path.join(base, type, year, month);
}

function answerDir(answer, base) {
  return dateDir(answer.created, base, 'answers');
}

// ─── Templates ──────────────────────────────────────────────────────────
function answerMarkdown(a) {
  const q = a.question || {};
  const topics = (q.topics || []).map(t => `#${t.name}`).join(' ');

  let md = `# [回答] ${q.title || '(无标题)'}\n\n`;
  if (topics) md += `> 话题: ${topics}\n`;
  if (q.detail_text) md += `> 问题补充：${q.detail_text}\n`;
  md += `\n`;
  md += `发布于 ${a.created} | 赞同 ${a.voteup_count} | 评论 ${a.comment_count} | 收藏 ${a.collect_count}\n\n`;
  md += `---\n\n`;

  if (a.content_html) {
    md += td.turndown(a.content_html);
  } else {
    md += `> *(内容缺失)*\n`;
  }

  md += `\n\n---\n\n`;
  md += `[原始链接](https://www.zhihu.com/answer/${a.id})\n`;
  return md;
}

function pinMarkdown(p) {
  const title = p.excerpt_title || p.content_html?.replace(/<[^>]+>/g, '').slice(0, 50) || '(想法)';

  let md = `# ${title}\n\n`;
  md += `发布于 ${p.created} | 赞同 ${p.like_count} | 评论 ${p.comment_count}\n\n`;

  // Show repost chain
  if (p.origin_pin) {
    md += `> **转发了** [@${p.origin_pin.author?.name || '?'}](${p.origin_pin.url})\n\n`;
  }
  if (p.repin) {
    md += `> **转发了** [@${p.repin.author?.name || '?'}](${p.repin.url})\n\n`;
  }

  md += `---\n\n`;

  if (p.content_html) {
    md += td.turndown(p.content_html);
  }

  // Include forwarded content
  if (p.origin_pin?.content_html) {
    md += `\n\n---\n\n### 转发的想法\n\n`;
    md += td.turndown(p.origin_pin.content_html);
  }
  if (p.repin?.content_html) {
    md += `\n\n---\n\n### 转发的想法\n\n`;
    md += td.turndown(p.repin.content_html);
  }

  md += `\n\n---\n\n`;
  md += `[原始链接](https://www.zhihu.com${p.url || ''})\n`;
  return md;
}

function articleMarkdown(a) {
  const topics = (a.topics || []).map(t => `#${t.name}`).join(' ');

  let md = `# ${a.title || '(无标题)'}\n\n`;
  if (a.column) {
    md += `> 专栏: [${a.column.title}](${a.column.url})\n`;
  } else {
    md += `> 个人文章\n`;
  }
  if (topics) md += `> 话题: ${topics}\n`;
  md += `\n`;
  md += `发布于 ${a.created} | 赞同 ${a.voteup_count} | 评论 ${a.comment_count}\n\n`;
  md += `---\n\n`;

  if (a.content_html) {
    md += td.turndown(a.content_html);
  } else {
    md += `> *(内容缺失)*\n`;
  }

  md += `\n\n---\n\n`;
  md += `[原始链接](${a.url || `https://zhuanlan.zhihu.com/p/${a.id}`})\n`;
  return md;
}

function indexMarkdown(name, answers, pins, articles) {
  const aTotal = answers?.total || answers?.answers?.length || 0;
  const pTotal = Array.isArray(pins) ? pins.length : 0;
  const artTotal = Array.isArray(articles) ? articles.length : 0;

  let md = `# Zhihu Archive — ${name}\n\n`;
  md += `Archived: ${new Date().toISOString().split('T')[0]}\n\n`;
  md += `## Stats\n\n`;
  md += `| Type | Count |\n`;
  md += `|------|-------|\n`;
  md += `| Answers | ${aTotal} |\n`;
  md += `| Pins | ${pTotal} |\n`;
  md += `| Articles | ${artTotal} |\n\n`;

  // Answers by year
  if (answers?.years) {
    md += `## Answers by Year\n\n`;
    md += `| Year | Count |\n`;
    md += `|------|-------|\n`;
    for (const [year, count] of Object.entries(answers.years).sort()) {
      md += `| ${year} | ${count} |\n`;
    }
  }

  md += `\n## Files\n\n`;
  md += `- \`answers/\` — ${aTotal} answer markdown files\n`;
  md += `- \`pins/\` — ${pTotal} pin markdown files\n`;
  md += `- \`articles/\` — ${artTotal} article markdown files\n`;
  return md;
}
