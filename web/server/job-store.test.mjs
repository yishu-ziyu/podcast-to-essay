import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createJobStore } from './storage/job-store.mjs';

function sample(id, state, extra = {}) {
  return {
    id,
    type: 'ingest',
    episodeSlug: '2026-09-22-link',
    sourceUrl: 'https://www.douyin.com/video/7123456789012345678',
    state,
    stage: 'downloading_media',
    progress: null,
    error: null,
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
    startedAt: '2026-09-22T00:00:00.000Z',
    finishedAt: null,
    requestId: `req-${id}`,
    owner: 'user',
    checkpoint: null,
    ...extra,
  };
}

test('job files are written by rename and half-written temp files are ignored', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'p2e-jobs-'));
  const store = createJobStore(dir);
  const id = '11111111-1111-4111-8111-111111111111';
  await store.write(sample(id, 'queued'));
  const onDisk = JSON.parse(await fsp.readFile(path.join(dir, `${id}.json`), 'utf8'));
  assert.equal(onDisk.state, 'queued');
  const temps = (await fsp.readdir(dir)).filter((name) => name.includes('.tmp'));
  assert.equal(temps.length, 0);

  await fsp.writeFile(path.join(dir, '22222222-2222-4222-8222-222222222222.json'), '{');
  await fsp.writeFile(path.join(dir, `${id}.json.999.tmp`), '{"state":"running"}');
  await store.load();
  assert.deepEqual(store.all().map((job) => job.id), [id]);
  await fsp.rm(dir, { recursive: true, force: true });
});

test('overlapping progress writes leave one complete job file', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'p2e-jobs-'));
  const store = createJobStore(dir);
  const id = '12121212-1212-4212-8212-121212121212';
  await Promise.all([0, 1, 2, 3, 4].map((n) => store.write(sample(id, 'running', { stage: `stage-${n}` }))));
  const onDisk = JSON.parse(await fsp.readFile(path.join(dir, `${id}.json`), 'utf8'));
  assert.equal(onDisk.stage, 'stage-4');
  assert.equal(store.get(id).stage, 'stage-4');
  const temps = (await fsp.readdir(dir)).filter((name) => name.includes('.tmp'));
  assert.equal(temps.length, 0);
  await fsp.rm(dir, { recursive: true, force: true });
});

test('restart turns a running job into interrupted unless the episode already has its result', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'p2e-jobs-'));
  const store = createJobStore(dir);
  const running = '33333333-3333-4333-8333-333333333333';
  const done = '44444444-4444-4444-8444-444444444444';
  const paused = '55555555-5555-4555-8555-555555555555';
  await store.write(sample(running, 'running'));
  await store.write(sample(done, 'running', { episodeSlug: 'done-one' }));
  await store.write(sample(paused, 'paused'));
  const changed = await store.recover(async (job) => job.episodeSlug === 'done-one');
  const states = Object.fromEntries(changed.map((job) => [job.id, job.state]));
  assert.equal(states[running], 'interrupted');
  assert.equal(states[paused], 'interrupted');
  assert.equal(states[done], 'succeeded');
  await store.load();
  assert.equal(store.get(running).state, 'interrupted');
  assert.equal(store.get(running).progress, null);
  await fsp.rm(dir, { recursive: true, force: true });
});
