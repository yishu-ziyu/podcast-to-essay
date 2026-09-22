import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkReady } from './infrastructure/dependency-check.mjs';

test('readiness fails when yt-dlp cannot be executed and does not echo secrets or home', async () => {
  const dataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'p2e-ready-'));
  const result = await checkReady({
    dataRoot,
    jobsDir: path.join(dataRoot, 'jobs'),
    minFreeBytes: 1,
    env: {
      STEP_API_KEY: 'super-secret-value',
      HOME: '/Users/secret-home',
      YTDLP_BIN: path.join(dataRoot, 'missing-yt-dlp'),
      FFMPEG_BIN: path.join(dataRoot, 'missing-ffmpeg'),
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.checks.ytdlp.ok, false);
  assert.equal(result.checks.ffmpeg.ok, false);
  assert.equal(result.checks.stepfun.ok, true);
  assert.equal(result.checks.data.ok, true);
  assert.equal(result.checks.jobStore.ok, true);
  const text = JSON.stringify(result);
  assert.doesNotMatch(text, /super-secret-value|secret-home|missing-yt-dlp|STEP_API_KEY/);
  await fsp.rm(dataRoot, { recursive: true, force: true });
});
