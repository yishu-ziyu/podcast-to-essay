import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEpisodeStore } from './storage/episode-store.mjs';
import { createJobStore } from './storage/job-store.mjs';

test('a fixture audio file is published atomically and survives restart recovery', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'p2e-fixture-'));
  const raw = path.join(root, 'raw');
  const cleaned = path.join(root, 'cleaned');
  await fsp.mkdir(raw);
  await fsp.mkdir(cleaned);
  const episodes = createEpisodeStore({ root, raw, cleaned });
  const stage = path.join(root, '.ingests', 'fixture');
  await fsp.mkdir(stage, { recursive: true });
  await fsp.writeFile(path.join(stage, 'source.mp3'), 'fixture-audio');
  await fsp.writeFile(path.join(stage, 'chunks', 'chunk_000.txt'), 'already done', 'utf8').catch(async () => {
    await fsp.mkdir(path.join(stage, 'chunks'), { recursive: true });
    await fsp.writeFile(path.join(stage, 'chunks', 'chunk_000.txt'), 'already done', 'utf8');
  });
  await episodes.publishIngest({
    slug: '2026-09-22-fixture',
    stageDir: stage,
    owner: 'user',
    url: 'https://cdn.example.com/fixture.mp3',
    title: 'fixture',
    file: 'source.mp3',
  });
  const episodeDir = path.join(raw, '2026-09-22-fixture');
  assert.equal(await fsp.readFile(path.join(episodeDir, 'source.mp3'), 'utf8'), 'fixture-audio');
  const meta = JSON.parse(await fsp.readFile(path.join(episodeDir, 'source-meta.json'), 'utf8'));
  assert.equal(meta.url, 'https://cdn.example.com/fixture.mp3');
  assert.equal(await fsp.readFile(path.join(episodeDir, 'chunks', 'chunk_000.txt'), 'utf8'), 'already done');

  const jobs = createJobStore(path.join(root, 'jobs'));
  await jobs.write({
    id: '66666666-6666-4666-8666-666666666666',
    type: 'ingest',
    episodeSlug: '2026-09-22-fixture',
    sourceUrl: meta.url,
    state: 'running',
    stage: 'downloading_media',
    progress: 40,
    error: null,
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
    startedAt: '2026-09-22T00:00:00.000Z',
    finishedAt: null,
    requestId: 'fixture',
    owner: 'user',
    checkpoint: null,
  });
  await jobs.write({
    id: '77777777-7777-4777-8777-777777777777',
    type: 'transcription',
    episodeSlug: '2026-09-22-open',
    sourceUrl: null,
    state: 'running',
    stage: 'transcribing',
    progress: null,
    error: null,
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
    startedAt: '2026-09-22T00:00:00.000Z',
    finishedAt: null,
    requestId: 'open',
    owner: 'user',
    checkpoint: null,
  });
  await jobs.recover((job) => episodes.hasDurableResult(job));
  assert.equal(jobs.get('66666666-6666-4666-8666-666666666666').state, 'succeeded');
  assert.equal(jobs.get('77777777-7777-4777-8777-777777777777').state, 'interrupted');
  assert.equal(await fsp.readFile(path.join(episodeDir, 'source.mp3'), 'utf8'), 'fixture-audio');
  assert.equal(await fsp.readFile(path.join(episodeDir, 'chunks', 'chunk_000.txt'), 'utf8'), 'already done');

  const staleDir = path.join(raw, '2026-09-22-stale');
  await fsp.mkdir(staleDir, { recursive: true });
  await fsp.writeFile(path.join(staleDir, 'source.mp3'), 'old-audio');
  await fsp.writeFile(path.join(staleDir, 'source-meta.json'), JSON.stringify({ url: 'https://cdn.example.com/old.mp3' }));
  const partDir = path.join(raw, '2026-09-22-part');
  await fsp.mkdir(partDir, { recursive: true });
  await fsp.writeFile(path.join(partDir, 'source.mp3.part'), 'half');
  await fsp.writeFile(path.join(partDir, 'source-meta.json'), JSON.stringify({ url: 'https://cdn.example.com/part.mp3' }));
  const bareDir = path.join(raw, '2026-09-22-bare');
  await fsp.mkdir(bareDir, { recursive: true });
  await fsp.writeFile(path.join(bareDir, 'source.mp3'), 'no-meta');
  const old = '2020-01-01T00:00:00.000Z';
  const future = '2099-01-01T00:00:00.000Z';
  await jobs.write({
    id: '88888888-8888-4888-8888-888888888888',
    type: 'ingest',
    episodeSlug: '2026-09-22-stale',
    sourceUrl: 'https://cdn.example.com/old.mp3',
    state: 'running',
    stage: 'downloading_media',
    progress: null,
    error: null,
    createdAt: future,
    updatedAt: future,
    startedAt: future,
    finishedAt: null,
    requestId: 'stale',
    owner: 'user',
    checkpoint: null,
  });
  await jobs.write({
    id: '99999999-9999-4999-8999-999999999999',
    type: 'ingest',
    episodeSlug: '2026-09-22-part',
    sourceUrl: 'https://cdn.example.com/part.mp3',
    state: 'running',
    stage: 'downloading_media',
    progress: null,
    error: null,
    createdAt: old,
    updatedAt: old,
    startedAt: old,
    finishedAt: null,
    requestId: 'part',
    owner: 'user',
    checkpoint: null,
  });
  await jobs.write({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    type: 'ingest',
    episodeSlug: '2026-09-22-bare',
    sourceUrl: 'https://cdn.example.com/bare.mp3',
    state: 'paused',
    stage: 'downloading_media',
    progress: null,
    error: null,
    createdAt: old,
    updatedAt: old,
    startedAt: old,
    finishedAt: null,
    requestId: 'bare',
    owner: 'user',
    checkpoint: null,
  });
  await jobs.recover((job) => episodes.hasDurableResult(job));
  assert.equal(jobs.get('88888888-8888-4888-8888-888888888888').state, 'interrupted');
  assert.equal(jobs.get('99999999-9999-4999-8999-999999999999').state, 'interrupted');
  assert.equal(jobs.get('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa').state, 'interrupted');
  assert.equal(await fsp.readFile(path.join(staleDir, 'source.mp3'), 'utf8'), 'old-audio');
  await fsp.rm(root, { recursive: true, force: true });
});
