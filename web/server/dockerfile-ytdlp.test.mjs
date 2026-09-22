// The public container failed with: /usr/bin/env: 'python3': No such file or directory
// because the image installed the Python zipapp named "yt-dlp", not a standalone binary.
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dockerfile = await fsp.readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'Dockerfile'), 'utf8');

test('runtime image installs the standalone linux binary and checks it before the image is usable', () => {
  assert.match(dockerfile, /yt-dlp_linux/);
  assert.match(dockerfile, /yt-dlp_linux_aarch64/);
  assert.doesNotMatch(dockerfile, /yt-dlp\$\{YT_SUFFIX\}/);
  assert.doesNotMatch(dockerfile, /download\/yt-dlp"/);
  const runtime = dockerfile.split(/^# Runtime/m).at(-1) || '';
  assert.match(runtime, /yt-dlp --version/);
  assert.match(runtime, /ffmpeg -version/);
  assert.match(runtime, /spawnSync\('yt-dlp'/);
  assert.match(runtime, /spawnSync\('ffmpeg'/);
});
