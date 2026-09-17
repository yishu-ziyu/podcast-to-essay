// Deleting an episode must remove both raw/<slug>/ and the cleaned article
// that belongs to it; leaving cleaned/<slug>.md behind produced orphans.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18972;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'test-pass';

const DATA_ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'p2e-delete-'));
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
assert.equal(login.status, 200, '登录失败，无法验证删除接口');
const cookie = login.headers.get('set-cookie')?.match(/p2e_session=[^;]+/)?.[0] || '';

function owner(pathname, options = {}) {
  return fetch(BASE + pathname, { ...options, headers: { cookie, ...(options.headers || {}) } });
}

test('删除条目时一并清掉 cleaned 文章', async () => {
  const slug = '2026-01-01-delete-me';
  const created = await owner('/api/episodes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug }),
  });
  assert.equal(created.status, 201);
  await fsp.writeFile(path.join(DATA_ROOT, 'cleaned', `${slug}.md`), '## 测试\n正文。\n', 'utf8');

  const res = await owner(`/api/episodes/${slug}`, { method: 'DELETE' });
  assert.equal(res.status, 200);

  await assert.rejects(fsp.stat(path.join(DATA_ROOT, 'raw', slug)), undefined, 'raw 目录应被删除');
  await assert.rejects(
    fsp.stat(path.join(DATA_ROOT, 'cleaned', `${slug}.md`)),
    undefined,
    'cleaned 文章应被删除',
  );
});

test('删除只影响自己的条目：不存在的条目返回 404', async () => {
  const res = await owner('/api/episodes/2026-01-01-not-there', { method: 'DELETE' });
  assert.equal(res.status, 404);
});
