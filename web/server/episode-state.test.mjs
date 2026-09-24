// The status shown for an episode follows its latest transcription attempt:
// a failure followed by a successful retry must not keep saying "转录失败".
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEpisodeStore } from './storage/episode-store.mjs';

async function storeWith(files, t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'p2e-state-'));
  const dir = path.join(root, 'raw', '2026-01-03-retry');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.mkdir(path.join(root, 'cleaned'));
  for (const [name, body] of Object.entries(files)) await fsp.writeFile(path.join(dir, name), body);
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  return { store: createEpisodeStore({ root, raw: path.join(root, 'raw'), cleaned: path.join(root, 'cleaned') }) };
}

const job = (state, updatedAt) => ({ id: state + updatedAt, type: 'transcription', episodeSlug: '2026-01-03-retry', state, updatedAt, error: { userMessage: '连不上转录服务。' } });

test('失败后重试成功：不再显示转录失败', async (t) => {
  const { store } = await storeWith({ 'source.mp3': 'x', 'asr_raw.txt': '[00:00:00,000] Speaker 0: 文本\n', 'transcription-state.json': '{"state":"failed"}' }, t);
  const [episode] = await store.list([job('failed', '2026-01-03T00:00:00Z'), job('succeeded', '2026-01-03T00:05:00Z')]);
  assert.equal(episode.status, 'transcribed');
  assert.equal(episode.transcription, null);
});

test('最近一次转录失败且没有初稿：显示转录失败', async (t) => {
  const { store } = await storeWith({ 'source.mp3': 'x' }, t);
  const [episode] = await store.list([job('succeeded', '2026-01-03T00:00:00Z'), job('failed', '2026-01-03T00:05:00Z')]);
  assert.equal(episode.transcription?.state, 'failed');
  assert.equal(episode.transcription?.error, '连不上转录服务。');
});
