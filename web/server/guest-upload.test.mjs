// Access rules around local-file upload: guests may create episodes and
// upload audio into their own entries, with quotas and cross-guest isolation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18971;
const BASE = `http://127.0.0.1:${PORT}`;

const DATA_ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'p2e-guest-upload-'));
const child = spawn(process.execPath, [path.join(__dirname, 'index.mjs')], {
  stdio: 'ignore',
  env: {
    ...process.env,
    DATA_ROOT,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    ACCESS_PASSWORD: 'test-pass',
    GUEST_INGEST_PER_DAY: '2',
    GUEST_TRANSCRIBE_PER_DAY: '9',
    GUEST_CLEAN_PER_DAY: '9',
  },
});

test.after(async () => {
  child.kill();
  await fsp.rm(DATA_ROOT, { recursive: true, force: true });
});

async function waitReady() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail('server did not start');
}
await waitReady();

function guest() {
  let cookie = '';
  return async (pathname, { method = 'GET', body, headers = {} } = {}) => {
    const r = await fetch(BASE + pathname, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...headers },
      body,
    });
    const setCookie = r.headers.get('set-cookie');
    const m = setCookie?.match(/p2e_guest=[^;]+/);
    if (m && !cookie) cookie = m[0];
    return r;
  };
}

async function ownerSession() {
  const r = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'test-pass' }),
  });
  return r.headers.get('set-cookie').match(/p2e_session=[^;]+/)[0];
}

const audioHeaders = { 'x-filename': 'source.mp3', 'x-original-name': encodeURIComponent('my episode.mp3') };

const alice = guest();

test('unauthenticated visitors are guests and can create an episode plus upload audio', async () => {
  const health = await (await alice('/api/health')).json();
  assert.equal(health.owner, false);
  assert.equal(health.guest.limits.ingest, 2);

  const created = await alice('/api/episodes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: '2026-09-05-alice-talk' }),
  });
  assert.equal(created.status, 201);

  const uploaded = await alice('/api/episodes/2026-09-05-alice-talk/audio', {
    method: 'POST',
    headers: audioHeaders,
    body: 'fake-audio-bytes',
  });
  assert.equal(uploaded.status, 200);

  const saved = await fsp.readFile(path.join(DATA_ROOT, 'raw', '2026-09-05-alice-talk', 'source.mp3'), 'utf8');
  assert.equal(saved, 'fake-audio-bytes');
  const ownerTag = JSON.parse(await fsp.readFile(path.join(DATA_ROOT, 'raw', '2026-09-05-alice-talk', 'owner.json'), 'utf8'));
  assert.match(ownerTag.owner, /^guest:/);

  const list = await (await alice('/api/episodes')).json();
  assert.ok(list.episodes.some((e) => e.slug === '2026-09-05-alice-talk'));
});

test("a guest cannot see or touch another visitor's episode", async () => {
  const bob = guest();
  const hijack = await bob('/api/episodes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: '2026-09-05-alice-talk' }),
  });
  assert.equal(hijack.status, 409);

  const upload = await bob('/api/episodes/2026-09-05-alice-talk/audio', { method: 'POST', headers: audioHeaders, body: 'x' });
  assert.equal(upload.status, 404);

  const list = await (await bob('/api/episodes')).json();
  assert.ok(!list.episodes.some((e) => e.slug === '2026-09-05-alice-talk'));
});

test('guest ingest quota counts episode creation and returns 429 when exhausted', async () => {
  const carol = guest();
  for (const slug of ['2026-09-05-carol-one', '2026-09-05-carol-two']) {
    const r = await carol('/api/episodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug }),
    });
    assert.equal(r.status, 201);
  }
  const third = await carol('/api/episodes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: '2026-09-05-carol-three' }),
  });
  assert.equal(third.status, 429);
});

test('invalid slugs are rejected before any quota or filesystem work', async () => {
  const dave = guest();
  const r = await dave('/api/episodes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: '../escape' }),
  });
  assert.equal(r.status, 400);
  const entries = await fsp.readdir(path.join(DATA_ROOT, 'raw'));
  assert.ok(!entries.some((name) => name.includes('escape')));
});

test('owner keeps full access; guests still cannot delete', async () => {
  const cookie = await ownerSession();
  const list = await (await fetch(`${BASE}/api/episodes`, { headers: { cookie } })).json();
  assert.ok(Array.isArray(list.episodes));

  const del = await alice('/api/episodes/2026-09-05-alice-talk', { method: 'DELETE' });
  assert.equal(del.status, 403);
});
