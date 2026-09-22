// Self-contained StepFun transcription runner. It deliberately writes one
// durable result per chunk so stopping or restarting never loses finished work.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const dir = process.argv[2];
const key = process.env.STEP_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
const stepBase = process.env.STEP_API_BASE || 'https://api.stepfun.com/step_plan/v1';
const asrModel = process.env.STEP_ASR_MODEL || 'stepaudio-2.5-asr';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} 退出 ${code}`)));
  });
}

function timestamp(seconds) {
  const ms = Math.round(seconds * 1000);
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor(ms % 3600000 / 60000)).padStart(2, '0');
  const s = String(Math.floor(ms % 60000 / 1000)).padStart(2, '0');
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, '0')}`;
}

async function transcribeChunk(file) {
  const audio = await fs.readFile(file);
  const res = await fetch(`${stepBase}/audio/asr/sse`, {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audio: {
        data: audio.toString('base64'),
        input: {
          transcription: {
            model: asrModel,
            language: 'zh',
            enable_itn: true,
          },
          format: { type: 'mp3' },
        },
      },
    }),
  });
  if (!res.ok) {
    if (res.status === 402) throw coded('transcription_quota_exhausted', '转录服务额度已用尽。补充额度后可以从这一段继续。');
    if (res.status === 401 || res.status === 403) throw coded('transcription_auth_failed', '转录服务授权失效，请检查设置后重试。');
    throw coded('internal_error', '转录服务暂时没有响应，请稍后重试。');
  }
  const events = (await res.text())
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== '[DONE]');
  let text = '';
  for (const event of events) {
    let data;
    try { data = JSON.parse(event); } catch { continue; }
    if (data.type === 'error') throw coded('internal_error', '转录服务返回错误。');
    if (data.type === 'transcript.text.delta') text += String(data.delta || '');
    if (data.type === 'transcript.text.done') text = String(data.text || text);
  }
  if (!text.trim()) throw coded('internal_error', '转录服务没有返回文字，请重试。');
  return text.trim();
}

function coded(code, userMessage) {
  const err = new Error(userMessage);
  err.code = code;
  err.userMessage = userMessage;
  return err;
}

async function main() {
  if (!dir) throw coded('internal_error', '缺少期次目录');
  if (!key) throw coded('transcription_auth_failed', '还没有配置转录服务，暂时不能转录。');
  const files = await fs.readdir(dir);
  const source = files.find((name) => /^source\./.test(name));
  if (!source) throw coded('internal_error', '这一卷没有音轨。');
  const chunks = path.join(dir, 'chunks');
  await fs.mkdir(chunks, { recursive: true });
  let parts = (await fs.readdir(chunks)).filter((name) => /^chunk_\d+\.mp3$/.test(name)).sort();
  if (!parts.length) {
    console.log('正在切分音轨…');
    await run('ffmpeg', ['-y', '-i', path.join(dir, source), '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '64k', '-f', 'segment', '-segment_time', '180', '-reset_timestamps', '1', path.join(chunks, 'chunk_%03d.mp3')]);
    parts = (await fs.readdir(chunks)).filter((name) => /^chunk_\d+\.mp3$/.test(name)).sort();
  }
  const rows = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const base = path.join(chunks, part.replace(/\.mp3$/, ''));
    let text = '';
    try { text = (await fs.readFile(base + '.txt', 'utf8')).trim(); } catch {}
    if (!text) {
      console.log(`正在识别 ${i + 1}/${parts.length}…`);
      text = await transcribeChunk(path.join(chunks, part));
      await fs.writeFile(base + '.txt', text, 'utf8');
    } else {
      console.log(`已保留 ${i + 1}/${parts.length}`);
    }
    rows.push({ start: i * 180, text });
  }
  const raw = rows.map(({ start, text }) => `[${timestamp(start)}] Speaker 0: ${text}`).join('\n');
  const srt = rows.map(({ start, text }, i) => `${i + 1}\n${timestamp(start)} --> ${timestamp(start + 180)}\n${text}`).join('\n\n');
  await fs.writeFile(path.join(dir, 'asr_raw.txt'), raw + '\n', 'utf8');
  await fs.writeFile(path.join(dir, 'asr_raw.srt'), srt + '\n', 'utf8');
  console.log('✅ 转录完成');
}

main().catch((err) => {
  const payload = {
    code: err.code || 'internal_error',
    userMessage: err.userMessage || err.message || '转录没有完成。',
  };
  console.log(`@@error ${JSON.stringify(payload)}`);
  console.error(`❌ ${payload.userMessage}`);
  process.exitCode = 1;
});
