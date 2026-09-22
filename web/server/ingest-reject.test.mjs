import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18973;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'p2e-reject-'));
const child = spawn(process.execPath, [path.join(__dirname, 'index.mjs')], {
  stdio: 'ignore',
  env: {
    ...process.env,
    DATA_ROOT,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    YTDLP_BIN: path.join(DATA_ROOT, 'yt-dlp-must-not-run'),
  },
});

test.after(async () => {
  child.kill();
  await fsp.rm(DATA_ROOT, { recursive: true, force: true });
});

for (let i = 0; i < 50; i += 1) {
  try {
    if ((await fetch(`${BASE}/api/health`)).ok) break;
  } catch { /* wait for listen */ }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

test('a Douyin self profile is rejected before any extractor starts', async () => {
  const started = Date.now();
  const response = await fetch(`${BASE}/api/ingests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.douyin.com/user/self?from_tab_name=main&showTab=post' }),
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.failure.code, 'unsupported_page');
  assert.equal(body.failure.kind, undefined);
  assert.equal(body.error, '这是抖音主页，不是具体视频。请打开要导入的视频，复制该视频的分享链接。');
  assert.ok(Date.now() - started < 1000);
  const jobs = await fsp.readdir(path.join(DATA_ROOT, 'jobs'));
  assert.deepEqual(jobs.filter((name) => name.endsWith('.json')), []);
});
