// Pull a concrete media URL into a staging directory. Callers publish that
// directory into raw/<slug>/ only after the audio file is complete.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { classifyMediaUrl } from '../domain/media-url.mjs';
import { failureForClassification, failureFromUnknown, interpretExtractor, makeError } from '../domain/errors.mjs';
import { runProcess } from '../infrastructure/process-runner.mjs';

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

const DEAD_SHARE_LINK = '这个分享链接没有打开具体视频，可能已失效或没复制完整。请在抖音里重新复制分享链接。';

function throwFailure(failure) {
  throw Object.assign(new Error(failure.userMessage), { failure, code: failure.code });
}

function versionParts(version) {
  const match = String(version || '').match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  return match ? match.slice(1).map(Number) : null;
}

function isOlderThan(version, minimum) {
  const a = versionParts(version);
  const b = versionParts(minimum);
  if (!a || !b) return true;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

async function followRedirects(href) {
  let current = href;
  for (let hop = 0; hop < 5; hop += 1) {
    const response = await fetch(current, { redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
    if (![301, 302, 303, 307, 308].includes(response.status)) return current;
    const location = response.headers.get('location');
    if (!location) throwFailure(makeError({ code: 'platform_refused', platform: 'douyin', stage: 'checking_url' }));
    const next = new URL(location, current);
    const checked = classifyMediaUrl(next.href);
    // An expired or truncated share link redirects to a non-video page (usually the Douyin home page);
    // "this is a profile page" would mislead someone who pasted a video share.
    if (!checked.supported && checked.kind !== 'douyin_short_link') {
      throwFailure({ ...failureForClassification(checked), userMessage: DEAD_SHARE_LINK });
    }
    current = checked.normalizedUrl || next.href;
  }
  throwFailure(makeError({ code: 'timeout', platform: 'douyin', stage: 'checking_url', userMessage: '短链重定向过多。请改用视频页面链接。' }));
  return current;
}

function stageFromLine(line) {
  const text = String(line || '');
  const percent = text.match(/\[download\]\s+(\d+(?:\.\d+)?)%/i)?.[1];
  if (percent) return { stage: 'downloading_media', percent: Number(percent) };
  if (/ExtractAudio|Destination:.*\.mp3/i.test(text)) return { stage: 'extracting_audio', percent: null };
  if (/Downloading video formats|Destination:/i.test(text)) return { stage: 'downloading_media', percent: null };
  if (/Downloading webpage|Extracting URL|Downloading wbi/i.test(text)) return { stage: 'reading_info', percent: null };
  return null;
}

async function downloadDirect(classified, dir, onProgress) {
  onProgress?.({ stage: 'downloading_media', percent: null });
  const response = await fetch(classified.normalizedUrl, { redirect: 'follow', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!response.ok) throwFailure(makeError({ code: 'platform_refused', platform: 'direct', stage: 'downloading_media' }));
  const ctype = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (ctype.includes('text/html') || ctype.includes('application/json') || ctype.includes('text/plain')) {
    throwFailure(makeError({ code: 'no_media_found', platform: 'direct', stage: 'downloading_media' }));
  }
  const url = new URL(classified.normalizedUrl);
  const ext = extFromName(url.pathname) || extFromMime(ctype) || '.bin';
  if (BLOCK_EXT.has(ext) || !(MEDIA_EXT.has(ext) || ctype.startsWith('audio/') || ctype.startsWith('video/'))) {
    throwFailure(makeError({ code: 'no_media_found', platform: 'direct', stage: 'downloading_media' }));
  }
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_BYTES) throwFailure(makeError({ code: 'file_too_large', stage: 'downloading_media', platform: 'direct' }));
  if (!response.body) throwFailure(makeError({ code: 'no_media_found', platform: 'direct', stage: 'downloading_media' }));
  const dest = path.join(dir, `source${ext}`);
  const ws = fs.createWriteStream(dest);
  let seen = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += value.byteLength;
      if (seen > MAX_BYTES) throwFailure(makeError({ code: 'file_too_large', stage: 'downloading_media', platform: 'direct' }));
      if (!ws.write(Buffer.from(value))) await new Promise((resolve) => ws.once('drain', resolve));
    }
  } catch (err) {
    ws.destroy();
    await fsp.rm(dest, { force: true });
    if (err.failure) throw err;
    if (err.code === 'ENOSPC') throwFailure(makeError({ code: 'disk_full', stage: 'downloading_media', platform: 'direct' }));
    throw err;
  }
  await new Promise((resolve, reject) => {
    ws.end(() => resolve());
    ws.on('error', reject);
  });
  const base = path.basename(url.pathname);
  let title = '';
  try { title = decodeURIComponent(base).replace(/\.[^.]+$/, ''); } catch { title = base; }
  return { file: path.basename(dest), title };
}

async function runYtDlp(classified, dir, home, onProgress) {
  const command = process.env.YTDLP_BIN || 'yt-dlp';
  let version = '';
  try {
    version = String(await runProcess(command, ['--version'], { cwd: dir, timeoutMs: 10 * 1000 })).trim().split('\n').at(-1) || '';
  } catch (err) {
    throwFailure(failureFromUnknown(err, { platform: classified.platform, stage: 'reading_info' }));
  }
  if (isOlderThan(version, MIN_YTDLP_VERSION)) {
    throwFailure(makeError({ code: 'extractor_outdated', stage: 'reading_info', platform: classified.platform }));
  }
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
  ];
  const cookies = process.env.YTDLP_COOKIES || path.join(home, '.config/yt-dlp/cookies.txt');
  if (fs.existsSync(cookies)) args.push('--cookies', cookies);
  if (classified.platform === 'bilibili') args.push('--referer', 'https://www.bilibili.com/');
  if (classified.platform === 'douyin') args.push('--referer', 'https://www.douyin.com/');
  args.push(classified.normalizedUrl);
  onProgress?.({ stage: 'reading_info', percent: null });
  let spawnErr = null;
  try {
    await runProcess(command, args, {
      cwd: dir,
      timeoutMs: 10 * 60 * 1000,
      onLine: (line) => {
        const next = stageFromLine(line);
        if (next) onProgress?.(next);
      },
    });
  } catch (err) {
    spawnErr = err;
  }
  const files = (await fsp.readdir(dir)).filter((name) => /^source\.[A-Za-z0-9]+$/.test(name));
  if (!files.length) {
    const failure = spawnErr?.code === 'timeout'
      ? makeError({ code: 'timeout', platform: classified.platform, stage: 'downloading_media' })
      : interpretExtractor(spawnErr?.output || spawnErr?.message || '', classified.platform, 'downloading_media');
    throwFailure(failure);
  }
  let title = '';
  try { title = (await fsp.readFile(titleFile, 'utf8')).trim(); } catch { /* title is optional */ }
  await fsp.rm(titleFile, { force: true });
  return { file: files[0], title };
}

export async function resolveSource(rawUrl) {
  let classified = classifyMediaUrl(rawUrl);
  if (!classified.supported) throwFailure(failureForClassification(classified));
  if (classified.kind === 'douyin_short_link') {
    const landed = await followRedirects(classified.normalizedUrl);
    classified = classifyMediaUrl(landed);
    if (classified.kind !== 'douyin_video') {
      throwFailure(failureForClassification({
        ...classified,
        supported: false,
        kind: classified.kind === 'invalid_url' ? 'invalid_url' : 'unsupported_page',
        reason: DEAD_SHARE_LINK,
      }));
    }
  }
  return classified;
}

export async function ingestUrl(rawUrl, dir, home, onProgress) {
  const classified = typeof rawUrl === 'string' ? await resolveSource(rawUrl) : rawUrl;
  if (!classified.supported) throwFailure(failureForClassification(classified));
  if (classified.kind === 'direct_media') return downloadDirect(classified, dir, onProgress);
  return runYtDlp(classified, dir, home, onProgress);
}
