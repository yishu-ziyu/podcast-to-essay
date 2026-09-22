import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18974;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'p2e-recover-'));
const jobId = '88888888-8888-4888-8888-888888888888';
await fsp.mkdir(path.join(DATA_ROOT, 'jobs'), { recursive: true });
await fsp.writeFile(path.join(DATA_ROOT, 'jobs', `${jobId}.json`), JSON.stringify({
  id: jobId,
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
  requestId: 'boot',
  owner: 'user',
  checkpoint: null,
}));
await fsp.mkdir(path.join(DATA_ROOT, 'raw', '2026-09-22-open', 'chunks'), { recursive: true });
await fsp.writeFile(path.join(DATA_ROOT, 'raw', '2026-09-22-open', 'chunks', 'chunk_000.txt'), 'kept', 'utf8');

const child = spawn(process.execPath, [path.join(__dirname, 'index.mjs')], {
  stdio: 'ignore',
  env: { ...process.env, DATA_ROOT, PORT: String(PORT), HOST: '127.0.0.1' },
});

test.after(async () => {
  child.kill();
  await fsp.rm(DATA_ROOT, { recursive: true, force: true });
});

for (let i = 0; i < 50; i += 1) {
  try {
    if ((await fetch(`${BASE}/api/health/live`)).ok) break;
  } catch { /* wait for listen */ }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

test('a running job is interrupted on boot and finished chunk text stays on disk', async () => {
  const response = await fetch(`${BASE}/api/jobs/${jobId}`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.job.state, 'interrupted');
  assert.match(body.job.label, /服务重启中断/);
  assert.equal(
    await fsp.readFile(path.join(DATA_ROOT, 'raw', '2026-09-22-open', 'chunks', 'chunk_000.txt'), 'utf8'),
    'kept',
  );
});
