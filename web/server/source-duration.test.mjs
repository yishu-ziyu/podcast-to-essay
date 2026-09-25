// Every new or replaced source records its duration in source-meta.json, the only
// place titles and durations are read from (docs/decisions/0007).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEpisodeStore } from './storage/episode-store.mjs';
import { formatDuration, probeDuration } from './infrastructure/media-probe.mjs';

async function store(probe) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'p2e-duration-'));
  const raw = path.join(root, 'raw');
  const cleaned = path.join(root, 'cleaned');
  await fsp.mkdir(raw);
  await fsp.mkdir(cleaned);
  const probed = [];
  const episodes = createEpisodeStore({
    root, raw, cleaned,
    probeDuration: async (file) => { probed.push(path.basename(file)); return probe(file); },
  });
  return { root, raw, episodes, probed };
}

const readMeta = async (raw, slug) => JSON.parse(await fsp.readFile(path.join(raw, slug, 'source-meta.json'), 'utf8'));

test('formatDuration renders whole seconds as HH:MM:SS', () => {
  assert.equal(formatDuration(38.6), '00:00:38');
  assert.equal(formatDuration(7365), '02:02:45');
  assert.equal(formatDuration(0.4), '00:00:00');
  assert.equal(formatDuration(NaN), null);
  assert.equal(formatDuration(-1), null);
});

test('link import writes the probed duration of the downloaded file', async () => {
  const { root, raw, episodes, probed } = await store(async () => '00:01:12');
  const stage = path.join(root, '.ingests', 'a');
  await fsp.mkdir(stage, { recursive: true });
  await fsp.writeFile(path.join(stage, 'source.mp3'), 'audio');
  await episodes.publishIngest({ slug: 's1', stageDir: stage, owner: 'user', url: 'https://example.com/a', title: 'A', file: 'source.mp3' });
  assert.deepEqual(probed, ['source.mp3']);
  assert.equal((await readMeta(raw, 's1')).duration, '00:01:12');
});

test('local upload writes the duration of the saved file', async () => {
  const { raw, episodes } = await store(async () => '00:00:38');
  const slug = await episodes.create('s3');
  await episodes.saveAudio(slug, {
    filename: 'source.m4a', originalName: '播客试音.m4a', stream: Readable.from([Buffer.from('audio')]),
    maxBytes: 1024, blocked: () => false,
  });
  assert.equal((await readMeta(raw, slug)).duration, '00:00:38');
});

test('replacing the audio replaces the duration, and an unreadable file leaves none', async () => {
  let next = '00:10:00';
  const { root, raw, episodes } = await store(async () => next);
  const stage = path.join(root, '.ingests', 'b');
  await fsp.mkdir(stage, { recursive: true });
  await fsp.writeFile(path.join(stage, 'source.mp3'), 'audio');
  await episodes.publishIngest({ slug: 's2', stageDir: stage, owner: 'user', url: 'https://example.com/b', title: 'B', file: 'source.mp3' });
  assert.equal((await readMeta(raw, 's2')).duration, '00:10:00');

  next = '00:02:00';
  const again = path.join(root, '.ingests', 'c');
  await fsp.mkdir(again, { recursive: true });
  await fsp.writeFile(path.join(again, 'source.mp3'), 'other audio');
  await episodes.adoptSource('s2', again, { url: 'https://example.com/c', title: 'C', file: 'source.mp3' });
  assert.equal((await readMeta(raw, 's2')).duration, '00:02:00');

  next = null;
  await episodes.saveAudio('s2', {
    filename: 'source.mp3', originalName: 'x.mp3', stream: Readable.from([Buffer.from('not audio')]),
    maxBytes: 1024, blocked: () => false,
  });
  assert.equal('duration' in (await readMeta(raw, 's2')), false, '读不到时长时不能保留旧音频的时长');
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;

test('probeDuration reads a real audio file and returns null for a non-audio file', { skip: !hasFfmpeg && '本机没有 ffmpeg/ffprobe' }, async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'p2e-probe-'));
  const audio = path.join(dir, 'tone.m4a');
  const made = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2.5', audio]);
  assert.equal(made.status, 0, String(made.stderr));
  assert.equal(await probeDuration(audio), '00:00:02');
  const junk = path.join(dir, 'junk.mp3');
  await fsp.writeFile(junk, 'not audio');
  assert.equal(await probeDuration(junk), null);
  await fsp.rm(dir, { recursive: true, force: true });
});
