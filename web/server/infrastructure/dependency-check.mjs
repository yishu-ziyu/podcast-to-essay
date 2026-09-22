import fsp from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from './process-runner.mjs';

// ponytail: one statfs sample per ready call. Upgrade path: cache for a few seconds if the probe itself becomes hot.
const DEFAULT_MIN_FREE = 512 * 1024 * 1024;

async function checkData(dataRoot) {
  try {
    await fsp.mkdir(dataRoot, { recursive: true });
    const probe = path.join(dataRoot, `.health-${process.pid}`);
    await fsp.writeFile(probe, 'ok');
    await fsp.rm(probe, { force: true });
    return { ok: true, detail: 'writable' };
  } catch {
    return { ok: false, detail: 'unwritable' };
  }
}

async function checkDisk(dataRoot, minFree) {
  try {
    const stats = await fsp.statfs(dataRoot);
    const free = Number(stats.bavail) * Number(stats.bsize);
    if (!Number.isFinite(free)) return { ok: false, detail: 'unknown' };
    return { ok: free >= minFree, detail: free >= minFree ? 'ok' : 'low' };
  } catch {
    return { ok: false, detail: 'unknown' };
  }
}

async function checkBin(command, args) {
  try {
    const output = await runProcess(command, args, { timeoutMs: 8000 });
    const line = String(output).trim().split('\n').find(Boolean) || '';
    const detail = line.includes('/') || line.includes('\\') ? 'ok' : line.slice(0, 80);
    return { ok: true, detail: detail || 'ok' };
  } catch {
    return { ok: false, detail: 'unavailable' };
  }
}

async function checkJobStore(dir) {
  try {
    await fsp.mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.probe-${process.pid}`);
    await fsp.writeFile(probe, 'ok');
    await fsp.rm(probe, { force: true });
    return { ok: true, detail: 'writable' };
  } catch {
    return { ok: false, detail: 'unwritable' };
  }
}

export async function checkReady({
  dataRoot,
  jobsDir,
  env = process.env,
  minFreeBytes = DEFAULT_MIN_FREE,
} = {}) {
  const ytdlp = env.YTDLP_BIN || 'yt-dlp';
  const ffmpeg = env.FFMPEG_BIN || 'ffmpeg';
  const checks = {
    data: await checkData(dataRoot),
    disk: await checkDisk(dataRoot, minFreeBytes),
    ytdlp: await checkBin(ytdlp, ['--version']),
    ffmpeg: await checkBin(ffmpeg, ['-version']),
    stepfun: {
      ok: Boolean(env.STEP_API_KEY || env.ANTHROPIC_AUTH_TOKEN),
      detail: (env.STEP_API_KEY || env.ANTHROPIC_AUTH_TOKEN) ? 'configured' : 'missing',
    },
    jobStore: await checkJobStore(jobsDir || path.join(dataRoot, 'jobs')),
  };
  return { ok: Object.values(checks).every((item) => item.ok), checks };
}
