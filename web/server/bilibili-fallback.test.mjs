// Bilibili answers HTTP 412 to its video web page from cloud-server IPs, and yt-dlp
// reads that page first. The public API still answers, so the import falls back to it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ingestUrl } from './services/media-ingest.mjs';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

async function fakeYtDlp(dir, stderr) {
  const bin = path.join(dir, 'fake-yt-dlp');
  await fsp.writeFile(bin, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 2026.08.19; exit 0; fi\necho '${stderr}' >&2\nexit 1\n`);
  await fsp.chmod(bin, 0o755);
  return bin;
}

// The view API is the most rate-limited one (412 even from home IPs after a few calls);
// pagelist and playurl keep answering, so single-part videos never touch view.
function fakeBilibili(audio, calls, pages = [{ cid: 222, part: '5 分钟学会写架构设计' }]) {
  return async (url, init = {}) => {
    const href = String(url);
    calls.push({ href, referer: init.headers?.referer });
    if (href.includes('/x/player/pagelist')) return Response.json({ code: 0, data: pages });
    if (href.includes('/x/web-interface/view')) return new Response('<!DOCTYPE html>', { status: 412 });
    if (href.includes('/x/player/playurl')) {
      return Response.json({ code: 0, data: { dash: { audio: [
        { id: 30280, bandwidth: 320000, baseUrl: 'https://upos.example/high.m4s' },
        { id: 30232, bandwidth: 132000, baseUrl: 'https://upos.example/mid.m4s', backupUrl: ['https://upos-backup.example/mid.m4s'] },
      ] } } });
    }
    if (href === 'https://upos.example/mid.m4s') return new Response(audio, { headers: { 'content-length': String(audio.length) } });
    return new Response('unexpected', { status: 404 });
  };
}

test('B 站网页返回 412 时，改用公开接口下载第一 P 的音频', { skip: !hasFfmpeg && '本机没有 ffmpeg' }, async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'p2e-bili-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const tone = path.join(dir, 'tone.m4a');
  assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', tone]).status, 0);
  const audio = await fsp.readFile(tone);
  await fsp.rm(tone);

  process.env.YTDLP_BIN = await fakeYtDlp(dir, 'ERROR: [BiliBili] 1CXet6gE6X: Unable to download webpage: HTTP Error 412: Precondition Failed');
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeBilibili(audio, calls);
  t.after(() => { globalThis.fetch = realFetch; delete process.env.YTDLP_BIN; });

  const stages = [];
  const out = await ingestUrl('https://www.bilibili.com/video/BV1CXet6gE6X', dir, dir, (p) => stages.push(p.stage));
  assert.deepEqual(out, { file: 'source.m4a', title: '5 分钟学会写架构设计' });
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(dir, 'source.m4a')], { encoding: 'utf8' });
  assert.ok(Math.abs(parseFloat(probe.stdout) - 2) < 0.2, `duration ${probe.stdout}`);
  assert.ok(calls.some((c) => c.href.includes('playurl') && c.href.includes('cid=222')), '用第一 P 的 cid');
  assert.ok(!calls.some((c) => c.href.includes('/x/web-interface/view')), '单 P 视频不请求风控最严的 view 接口');
  assert.ok(calls.filter((c) => c.href.includes('upos')).every((c) => c.referer === 'https://www.bilibili.com/'), '下载音频要带 B 站 Referer');
  assert.ok(stages.includes('downloading_media'));
  assert.deepEqual((await fsp.readdir(dir)).filter((f) => f.startsWith('source') || f.includes('bili')), ['source.m4a'], '不留临时文件');
});

test('接口也失败时，仍给出原来的「B 站拒绝」提示', async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'p2e-bili-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  process.env.YTDLP_BIN = await fakeYtDlp(dir, 'ERROR: HTTP Error 412: Precondition Failed');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ code: -352, message: '风控校验失败' });
  t.after(() => { globalThis.fetch = realFetch; delete process.env.YTDLP_BIN; });

  await assert.rejects(ingestUrl('https://www.bilibili.com/video/BV1CXet6gE6X', dir, dir), (err) => {
    assert.equal(err.failure.code, 'platform_refused');
    assert.match(err.failure.userMessage, /B 站/);
    return true;
  });
});

test('其他平台被拒绝时不走 B 站接口', async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'p2e-bili-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  process.env.YTDLP_BIN = await fakeYtDlp(dir, 'ERROR: HTTP Error 403: Forbidden');
  const realFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; return new Response('', { status: 500 }); };
  t.after(() => { globalThis.fetch = realFetch; delete process.env.YTDLP_BIN; });

  await assert.rejects(ingestUrl('https://www.youtube.com/watch?v=jNQXAC9IVRw', dir, dir), (err) => err.failure.code === 'platform_refused');
  assert.equal(fetched, false);
});

test('多 P 视频取总标题；view 接口被拦时退回第一 P 的标题', { skip: !hasFfmpeg && '本机没有 ffmpeg' }, async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'p2e-bili-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const tone = path.join(dir, 'tone.m4a');
  assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', tone]).status, 0);
  const audio = await fsp.readFile(tone);
  await fsp.rm(tone);
  process.env.YTDLP_BIN = await fakeYtDlp(dir, 'ERROR: HTTP Error 412: Precondition Failed');
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; delete process.env.YTDLP_BIN; });

  const pages = [{ cid: 222, part: '上集' }, { cid: 333, part: '下集' }];
  const base = fakeBilibili(audio, [], pages);
  globalThis.fetch = async (url, init) => (String(url).includes('/x/web-interface/view')
    ? Response.json({ code: 0, data: { title: '系列课程' } })
    : base(url, init));
  assert.equal((await ingestUrl('https://www.bilibili.com/video/BV1CXet6gE6X', dir, dir)).title, '系列课程 · 上集');

  await fsp.rm(path.join(dir, 'source.m4a'));
  globalThis.fetch = base;
  assert.equal((await ingestUrl('https://www.bilibili.com/video/BV1CXet6gE6X', dir, dir)).title, '上集');
});
