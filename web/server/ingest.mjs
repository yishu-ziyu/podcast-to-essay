// Pull audio from a public URL (direct file or yt-dlp site) into raw/<slug>/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const MEDIA_EXT = new Set([
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wma',
  '.aiff', '.aif', '.caf', '.amr', '.mka', '.weba', '.oga',
  '.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi', '.ts', '.mpeg', '.mpg', '.3gp',
]);

export const BLOCK_EXT = new Set([
  '.js', '.mjs', '.cjs', '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  '.exe', '.dll', '.php', '.html', '.htm', '.svg', '.xml', '.json',
]);

const MAX_BYTES = 1.5 * 1024 * 1024 * 1024;
const MIN_YTDLP_VERSION = '2026.07.04';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const MIME_EXT = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/flac': '.flac',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/webm': '.weba',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-matroska': '.mkv',
};

export function extFromName(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (!ext || BLOCK_EXT.has(ext)) return '';
  return ext;
}

export function extFromMime(ctype) {
  const key = String(ctype || '').split(';')[0].trim().toLowerCase();
  return MIME_EXT[key] || '';
}

export function assertPublicHttpUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); }
  catch { throw new Error('这不是一条能打开的链接'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('只收 http 或 https 链接');
  }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') {
    throw new Error('不收本机链接');
  }
  if (host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('不收内网链接');
  }
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ip) {
    const a = Number(ip[1]);
    const b = Number(ip[2]);
    if (a === 10 || a === 127 || a === 0 || a === 255) throw new Error('不收内网链接');
    if (a === 192 && b === 168) throw new Error('不收内网链接');
    if (a === 172 && b >= 16 && b <= 31) throw new Error('不收内网链接');
    if (a === 169 && b === 254) throw new Error('不收内网链接');
  }
  return u;
}

export function prefersExtractor(host) {
  return /bilibili|b23\.tv|douyin|iesdouyin|tiktok|youtube|youtu\.be|xiaoyuzhou|ximalaya|podcasts\.apple|soundcloud|spotify|music\.163|castbox|v\.qq\.com|iqiyi|youku|podcast/.test(String(host || '').toLowerCase());
}

export async function clearSourceFiles(dir) {
  let files = [];
  try { files = await fsp.readdir(dir); } catch { return; }
  for (const f of files) {
    if (/^source\.[A-Za-z0-9]+$/.test(f)) await fsp.rm(path.join(dir, f), { force: true });
  }
}

export async function writeMeta(dir, meta) {
  await fsp.writeFile(path.join(dir, 'source-meta.json'), JSON.stringify(meta, null, 2), 'utf8');
}

export async function readMeta(dir) {
  try {
    return JSON.parse(await fsp.readFile(path.join(dir, 'source-meta.json'), 'utf8'));
  } catch {
    return null;
  }
}

function cookieArgs(home) {
  const p = process.env.YTDLP_COOKIES || path.join(home, '.config/yt-dlp/cookies.txt');
  return fs.existsSync(p) ? ['--cookies', p] : [];
}

function lastUseful(buf) {
  const lines = String(buf || '').split('\n').map((s) => s.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const s = lines[i];
    if (/ERROR:/i.test(s)) return s.replace(/^ERROR:\s*/i, '');
  }
  return lines.at(-1) || '';
}

function versionParts(v) {
  const match = String(v || '').match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  return match ? match.slice(1).map(Number) : null;
}

function isOlderThan(version, minimum) {
  const a = versionParts(version);
  const b = versionParts(minimum);
  if (!a || !b) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

function spawnLogged(cmd, args, cwd, onLog, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: process.env });
    let buf = '';
    const onData = (d) => {
      const text = d.toString();
      buf += text;
      for (const line of text.split('\n')) {
        const s = line.trim();
        if (s) onLog(s.slice(0, 240));
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const t = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error('拉取超时'));
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(t);
      reject(new Error(e.code === 'ENOENT' ? '本机没有 yt-dlp' : e.message));
    });
    child.on('exit', (code) => {
      clearTimeout(t);
      if (code === 0) resolve(buf);
      else reject(new Error(lastUseful(buf) || `yt-dlp 退出 ${code}`));
    });
  });
}

async function assertCurrentYtDlp(cmd, cwd) {
  const output = await spawnLogged(cmd, ['--version'], cwd, () => {}, 10 * 1000);
  const version = String(output).trim().split('\n').at(-1) || '';
  if (isOlderThan(version, MIN_YTDLP_VERSION)) {
    const err = new Error(`下载组件版本过旧（${version || '未知'}）`);
    err.code = 'YTDLP_OUTDATED';
    throw err;
  }
}

async function fetchPublicHttp(url, { hops = 0 } = {}) {
  if (hops > 5) throw new Error('重定向过多');
  const res = await fetch(url.href, {
    redirect: 'manual',
    headers: { 'user-agent': UA },
  });
  if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
    const loc = res.headers.get('location');
    if (!loc) throw new Error('重定向缺少地址');
    const next = assertPublicHttpUrl(new URL(loc, url.href).href);
    return fetchPublicHttp(next, { hops: hops + 1 });
  }
  return res;
}

async function downloadDirect(url, dir, onLog) {
  onLog('按直链拉取…');
  const res = await fetchPublicHttp(url);
  if (!res.ok) throw new Error(`链接返回 ${res.status}`);
  const ctype = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (ctype.includes('text/html') || ctype.includes('application/json') || ctype.includes('text/plain')) {
    throw Object.assign(new Error('not-media'), { code: 'NOT_MEDIA' });
  }
  const ext = extFromName(url.pathname) || extFromMime(ctype) || '.bin';
  if (BLOCK_EXT.has(ext)) throw Object.assign(new Error('not-media'), { code: 'NOT_MEDIA' });
  const mediaLike = MEDIA_EXT.has(ext) || ctype.startsWith('audio/') || ctype.startsWith('video/');
  if (!mediaLike) throw Object.assign(new Error('not-media'), { code: 'NOT_MEDIA' });
  const dest = path.join(dir, 'source' + ext);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new Error('文件太大（超过 1.5 GB）');
  if (!res.body) throw new Error('空响应');
  await clearSourceFiles(dir);
  const ws = fs.createWriteStream(dest);
  let seen = 0;
  const reader = res.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += value.byteLength;
      if (seen > MAX_BYTES) throw new Error('文件太大（超过 1.5 GB）');
      if (!ws.write(Buffer.from(value))) {
        await new Promise((r) => ws.once('drain', r));
      }
    }
  } catch (err) {
    ws.destroy();
    await fsp.rm(dest, { force: true });
    throw err;
  }
  await new Promise((resolve, reject) => {
    ws.end(() => resolve());
    ws.on('error', reject);
  });
  onLog('已落到 ' + path.basename(dest));
  const base = path.basename(url.pathname);
  let title = '';
  try { title = decodeURIComponent(base).replace(/\.[^.]+$/, ''); } catch { title = base; }
  return { file: path.basename(dest), title };
}

async function runYtDlp(url, dir, home, onLog) {
  await clearSourceFiles(dir);
  const command = process.env.YTDLP_BIN || 'yt-dlp';
  await assertCurrentYtDlp(command, dir);
  const titleFile = path.join(dir, '.yt-title.txt');
  const args = [
    '--no-playlist',
    '--newline',
    '-x', '--audio-format', 'mp3', '--audio-quality', '5',
    '--restrict-filenames',
    '--no-mtime',
    '-o', path.join(dir, 'source.%(ext)s'),
    '--print-to-file', 'after_move:%(title)s', titleFile,
    '--user-agent', UA,
    ...cookieArgs(home),
  ];
  const host = url.hostname.toLowerCase();
  if (/bilibili|b23\.tv/.test(host)) {
    args.push('--referer', 'https://www.bilibili.com/');
  }
  if (/douyin|iesdouyin/.test(host)) {
    args.push('--referer', 'https://www.douyin.com/');
  }
  args.push(url.href);
  onLog('用 yt-dlp 取音轨…');
  let spawnErr = null;
  try {
    await spawnLogged(command, args, dir, onLog, 10 * 60 * 1000);
  } catch (err) {
    spawnErr = err;
  }
  const files = (await fsp.readdir(dir)).filter((f) => /^source\.[A-Za-z0-9]+$/.test(f));
  if (!files.length) {
    throw spawnErr || new Error('没有拿到音轨。链接可能要登录，或平台拦了。可把 cookies 放到 ~/.config/yt-dlp/cookies.txt');
  }
  let title = '';
  try {
    title = (await fsp.readFile(titleFile, 'utf8')).trim();
  } catch {}
  await fsp.rm(titleFile, { force: true });
  return { file: files[0], title };
}

export async function ingestUrl(urlRaw, dir, home, onLog) {
  const url = assertPublicHttpUrl(urlRaw);
  const host = url.hostname.toLowerCase();
  if (prefersExtractor(host)) {
    return runYtDlp(url, dir, home, onLog);
  }
  try {
    return await downloadDirect(url, dir, onLog);
  } catch (err) {
    if (err.code === 'NOT_MEDIA' || /返回 40/.test(err.message)) {
      onLog('直链不像音轨，改用 yt-dlp…');
      return runYtDlp(url, dir, home, onLog);
    }
    throw err;
  }
}
