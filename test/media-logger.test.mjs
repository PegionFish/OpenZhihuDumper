import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { downloadImages } from '../lib/media.mjs';

const originalFetch = global.fetch;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-media-test-'));

async function run() {
  const events = [];
  const logger = {
    start(total) { events.push({ type: 'start', total }); },
    progress(p) { events.push({ type: 'progress', ...p }); },
    done(d) { events.push({ type: 'done', ...d }); },
    complete(c) { events.push({ type: 'complete', ...c }); },
  };

  global.fetch = async (url) => {
    if (url.includes('fail')) {
      return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
  };

  const html = `
    <img src="https://pic1.zhimg.com/v2-ok.jpg">
    <img src="https://pic1.zhimg.com/v2-fail.jpg">
    <img src="https://pic1.zhimg.com/v2-ok.jpg">
  `;

  const { manifest } = await downloadImages(html, '123', 'answer', tmp, 2, logger);

  assert.strictEqual(manifest.length, 3, 'expected 3 image entries');
  assert.ok(events.some(e => e.type === 'start' && e.total === 3), 'start event missing');
  assert.ok(events.some(e => e.type === 'done' && e.failed), 'failed done event missing');
  assert.ok(events.some(e => e.type === 'done' && e.skipped), 'skipped done event missing');
  assert.ok(events.some(e => e.type === 'done' && !e.failed && !e.skipped && !e.fallback), 'success done event missing');
  assert.ok(events.some(e => e.type === 'complete'), 'complete event missing');

  console.log('All logger callback tests passed.');
}

run().finally(() => {
  global.fetch = originalFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
}).catch(e => {
  console.error(e);
  process.exit(1);
});
