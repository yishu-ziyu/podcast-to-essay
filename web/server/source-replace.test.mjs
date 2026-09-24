// Replacing the audio of an episode must drop everything transcribed from the old
// audio; stale chunks/ would otherwise be reused and transcribe the old recording.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18975;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'test-pass';

const DATA_ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'p2e-replace-'));
const child = spawn(process.execPath, [path.join(__dirname, 'index.mjs')], {
  stdio: 'ignore',
  env: { ...process.env, DATA_ROOT, PORT: String(PORT), HOST: '127.0.0.1', ACCESS_PASSWORD: PASSWORD },
});

test.after(async () => {
  child.kill();
  await fsp.rm(DATA_ROOT, { recursive: true, force: true });
});

for (let i = 0; i < 50; i += 1) {
  try {
    if ((await fetch(`${BASE}/api/health`)).ok) break;
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const login = await fetch(`${BASE}/api/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: PASSWORD }),
});
assert.equal(login.status, 200, '登录失败，无法验证更换音轨');
const cookie = login.headers.get('set-cookie')?.match(/p2e_session=[^;]+/)?.[0] || '';

function owner(pathname, options = {}) {
  return fetch(BASE + pathname, { ...options, headers: { cookie, ...(options.headers || {}) } });
}

function upload(slug, name) {
  return owner(`/api/episodes/${slug}/audio`, {
    method: 'POST',
    headers: { 'x-filename': 'source.mp3', 'x-original-name': encodeURIComponent(name) },
    body: Buffer.from('fake audio'),
  });
}

async function episode(slug) {
  const { episodes } = await (await owner('/api/episodes')).json();
  return episodes.find((item) => item.slug === slug);
}

test('更换音轨清空旧初稿、分段稿和分段缓存，保留标题', async () => {
  const slug = '2026-01-01-replace-me';
  assert.equal((await owner('/api/episodes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug }),
  })).status, 201);
  assert.equal((await upload(slug, 'old.mp3')).status, 200);
  assert.equal((await owner(`/api/episodes/${slug}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '我起的名字' }),
  })).status, 200);

  const dir = path.join(DATA_ROOT, 'raw', slug);
  await fsp.mkdir(path.join(dir, 'chunks'), { recursive: true });
  await fsp.writeFile(path.join(dir, 'chunks', 'chunk_000.mp3'), 'old');
  await fsp.writeFile(path.join(dir, 'chunks', 'chunk_000.txt'), 'old text');
  await fsp.writeFile(path.join(dir, 'asr_raw.txt'), 'old transcript\n');
  await fsp.writeFile(path.join(dir, 'asr_raw.srt'), '1\n00:00:00,000 --> 00:03:00,000\nold\n');
  await fsp.writeFile(path.join(dir, 'transcription-state.json'), '{"state":"failed","error":"旧错误"}');
  assert.equal((await episode(slug)).status, 'transcribed');

  assert.equal((await upload(slug, 'new.m4a')).status, 200);

  const after = await episode(slug);
  assert.equal(after.status, 'uploaded');
  assert.equal(after.hasRaw, false);
  assert.equal(after.hasSrt, false);
  assert.equal(after.chunkCount, 0);
  assert.equal(after.completedChunks, 0);
  assert.equal(after.transcription, null, '旧音轨的失败状态不应带到新音轨');
  assert.equal(after.title, '我起的名字');
  assert.equal(after.originalName, 'new.m4a');
  await assert.rejects(fsp.stat(path.join(dir, 'chunks')), undefined, '旧分段缓存应被删除');
});
