import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createJobRunner } from './services/job-runner.mjs';
import { createJobStore } from './storage/job-store.mjs';

async function runnerWith(handler, limits) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'p2e-runner-'));
  const store = createJobStore(dir);
  await store.load();
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  const runner = createJobRunner({
    store,
    limits,
    handlers: {
      ingest: async (job, tools) => {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        try { await handler(job, tools); }
        finally { active -= 1; }
      },
    },
  });
  return {
    runner,
    store,
    stats: () => ({ calls, maxActive }),
    cleanup: () => fsp.rm(dir, { recursive: true, force: true }),
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function settle(read, ms = 1000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (read()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out: ${JSON.stringify(read())}`);
}

test('closing the observer does not stop the job', async () => {
  const gate = deferred();
  const box = await runnerWith(() => gate.promise);
  const accepted = await box.runner.accept({
    type: 'ingest',
    episodeSlug: 'ep-1',
    sourceUrl: 'https://cdn.example.com/a.mp3',
    requestId: 'req-observe',
    owner: 'user',
  });
  let seen = 0;
  const unsubscribe = box.runner.watch(accepted.job.id, () => { seen += 1; });
  unsubscribe();
  gate.resolve();
  await settle(() => box.store.get(accepted.job.id)?.state === 'succeeded');
  assert.equal(box.store.get(accepted.job.id).state, 'succeeded');
  assert.ok(seen >= 1);
  await box.cleanup();
});

test('the same request or the same active episode does not start a second ingest', async () => {
  const gate = deferred();
  const box = await runnerWith(() => gate.promise);
  const first = await box.runner.accept({
    type: 'ingest',
    episodeSlug: 'ep-1',
    sourceUrl: 'https://www.douyin.com/video/1',
    requestId: 'same-request',
    owner: 'user',
  });
  const second = await box.runner.accept({
    type: 'ingest',
    episodeSlug: 'ep-9',
    sourceUrl: 'https://www.douyin.com/video/9',
    requestId: 'same-request',
    owner: 'user',
  });
  const third = await box.runner.accept({
    type: 'ingest',
    episodeSlug: 'ep-1',
    sourceUrl: 'https://www.douyin.com/video/1',
    requestId: 'other-request',
    owner: 'user',
  });
  assert.equal(second.job.id, first.job.id);
  assert.equal(second.created, false);
  assert.equal(third.job.id, first.job.id);
  gate.resolve();
  await settle(() => box.store.get(first.job.id)?.state === 'succeeded');
  assert.equal(box.stats().calls, 1);
  await box.cleanup();
});

test('the same requestId from another owner is a different job', async () => {
  const gate = deferred();
  const box = await runnerWith(() => gate.promise);
  const first = await box.runner.accept({
    type: 'ingest',
    episodeSlug: 'ep-a',
    sourceUrl: 'https://cdn.example.com/a.mp3',
    requestId: 'shared-request',
    owner: 'guest:a',
  });
  const second = await box.runner.accept({
    type: 'ingest',
    episodeSlug: 'ep-b',
    sourceUrl: 'https://cdn.example.com/b.mp3',
    requestId: 'shared-request',
    owner: 'guest:b',
  });
  assert.notEqual(second.job.id, first.job.id);
  gate.resolve();
  await settle(() => box.store.all().every((job) => job.state === 'succeeded'));
  assert.equal(box.stats().calls, 2);
  await box.cleanup();
});

test('two concurrent submits for one episode start one ingest', async () => {
  const gate = deferred();
  const box = await runnerWith(() => gate.promise);
  const [first, second] = await Promise.all([
    box.runner.accept({
      type: 'ingest',
      episodeSlug: 'ep-1',
      sourceUrl: 'https://cdn.example.com/a.mp3',
      requestId: 'req-a',
      owner: 'user',
    }),
    box.runner.accept({
      type: 'ingest',
      episodeSlug: 'ep-1',
      sourceUrl: 'https://cdn.example.com/a.mp3',
      requestId: 'req-b',
      owner: 'user',
    }),
  ]);
  assert.equal(first.job.id, second.job.id);
  assert.equal(box.store.all().length, 1);
  gate.resolve();
  await settle(() => box.store.get(first.job.id)?.state === 'succeeded');
  assert.equal(box.stats().calls, 1);
  await box.cleanup();
});

test('a failed ingest releases the slot for the next job', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'p2e-runner-'));
  const store = createJobStore(dir);
  await store.load();
  const gate = deferred();
  let started = 0;
  const runner = createJobRunner({
    store,
    limits: { ingest: 1 },
    handlers: {
      ingest: async (job) => {
        started += 1;
        if (job.episodeSlug === 'ep-1') throw new Error('boom');
        await gate.promise;
      },
    },
  });
  await runner.accept({
    type: 'ingest', episodeSlug: 'ep-1', sourceUrl: 'https://cdn.example.com/1.mp3', requestId: 'req-1', owner: 'user',
  });
  await runner.accept({
    type: 'ingest', episodeSlug: 'ep-2', sourceUrl: 'https://cdn.example.com/2.mp3', requestId: 'req-2', owner: 'user',
  });
  await settle(() => store.all().some((job) => job.state === 'failed') && store.all().some((job) => job.state === 'running'));
  assert.equal(started, 2);
  assert.equal(runner.runningCount('ingest'), 1);
  gate.resolve();
  await settle(() => store.all().every((job) => job.state === 'failed' || job.state === 'succeeded'));
  await fsp.rm(dir, { recursive: true, force: true });
});

test('ingest concurrency stays at one and later jobs wait', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'p2e-runner-'));
  const store = createJobStore(dir);
  await store.load();
  const gates = [deferred(), deferred(), deferred()];
  let started = 0;
  let active = 0;
  let maxActive = 0;
  const runner = createJobRunner({
    store,
    limits: { ingest: 1 },
    handlers: {
      ingest: async () => {
        started += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await gates[started - 1].promise;
        active -= 1;
      },
    },
  });
  await Promise.all([1, 2, 3].map((n) => runner.accept({
    type: 'ingest',
    episodeSlug: `ep-${n}`,
    sourceUrl: `https://cdn.example.com/${n}.mp3`,
    requestId: `req-${n}`,
    owner: 'user',
  })));
  await settle(() => store.all().filter((job) => job.state === 'queued').length === 2 && maxActive === 1);
  assert.equal(maxActive, 1);
  assert.equal(store.all().filter((job) => job.state === 'queued').length, 2);
  gates[0].resolve();
  await settle(() => store.all().filter((job) => job.state === 'running').length === 1 && store.all().filter((job) => job.state === 'succeeded').length === 1);
  assert.equal(maxActive, 1);
  gates[1].resolve();
  gates[2].resolve();
  await settle(() => store.all().every((job) => job.state === 'succeeded'));
  assert.equal(store.all().every((job) => job.state === 'succeeded'), true);
  await fsp.rm(dir, { recursive: true, force: true });
});
