#!/bin/sh
# Local gate before a production deploy. Does not touch the Aliyun host.
set -eu
cd "$(dirname "$0")/.."
npm test
npm run build
git -C "$(pwd)/.." diff --check
mkdir -p ytdlp-assets
if [ ! -s ytdlp-assets/yt-dlp_linux ]; then
  curl -fL --http1.1 --retry 5 --retry-all-errors \
    -o ytdlp-assets/yt-dlp_linux \
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"
fi
image="podcast-to-essay-web:predeploy"
docker build -t "$image" .
docker run --rm --entrypoint yt-dlp "$image" --version
docker run --rm --entrypoint ffmpeg "$image" -version
docker run --rm --network none \
  -e STEP_API_KEY=configured \
  -e DATA_ROOT=/tmp/p2e-ready \
  --entrypoint node \
  "$image" \
  --input-type=module -e "import { checkReady } from './server/infrastructure/dependency-check.mjs'; const ready = await checkReady({ dataRoot: '/tmp/p2e-ready', env: process.env, minFreeBytes: 1 }); const checks = Object.fromEntries(Object.entries(ready.checks).map(([name, item]) => [name, item.ok])); console.log(JSON.stringify({ ok: ready.ok, checks })); if (!ready.ok) process.exit(1);"
