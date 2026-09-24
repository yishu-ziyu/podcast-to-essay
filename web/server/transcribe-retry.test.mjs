// A chunk that hits a network blip is retried instead of failing the whole transcription,
// and a persistent outage reaches the user as plain language, not "fetch failed".
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fakeAsr(failFirst) {
  let calls = 0;
  const server = http.createServer((req, res) => {
    calls += 1;
    req.resume();
    if (calls <= failFirst) { req.socket.destroy(); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: {"type":"transcript.text.done","text":"模拟识别结果"}\n\ndata: [DONE]\n\n');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls: () => calls })));
}

async function episodeDir() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'p2e-retry-'));
  await fsp.mkdir(path.join(dir, 'chunks'));
  await fsp.writeFile(path.join(dir, 'source.mp3'), 'x');
  await fsp.writeFile(path.join(dir, 'chunks', 'chunk_000.mp3'), 'fake audio');
  return dir;
}

function runTranscribe(dir, port) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'transcribe.mjs'), dir], {
      env: { ...process.env, STEP_API_KEY: 'test', STEP_API_BASE: `http://127.0.0.1:${port}` },
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => resolve({ code, out }));
  });
}

test('网络断两次后第三次成功，转录照常完成', async () => {
  const asr = await fakeAsr(2);
  const dir = await episodeDir();
  try {
    const { code, out } = await runTranscribe(dir, asr.server.address().port);
    assert.equal(code, 0, out);
    assert.equal(asr.calls(), 3);
    assert.match(await fsp.readFile(path.join(dir, 'asr_raw.txt'), 'utf8'), /模拟识别结果/);
  } finally {
    asr.server.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('一直连不上时给出人话提示，不暴露 fetch failed', async () => {
  const asr = await fakeAsr(99);
  const dir = await episodeDir();
  try {
    const { code, out } = await runTranscribe(dir, asr.server.address().port);
    assert.equal(code, 1);
    assert.equal(asr.calls(), 3, '重试两次后停止');
    assert.match(out, /连不上转录服务/);
    assert.doesNotMatch(out.split('\n').find((line) => line.startsWith('@@error')) || '', /fetch failed/);
  } finally {
    asr.server.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
