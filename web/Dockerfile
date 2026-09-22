# Build frontend
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: the build only needs vite/tsc, but electron's postinstall
# downloads ~100MB from GitHub and stalls builds on CN servers.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# Runtime
FROM node:22-slim
# Use Aliyun apt mirror for fast downloads on CN servers
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null \
    || sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list
# Official standalone ELF, fetched before docker build (see scripts/predeploy.sh).
# yt-dlp_linux / yt-dlp_linux_aarch64 are the standalone binaries.
# The asset named "yt-dlp" is a Python zipapp and exits with: python3: No such file or directory.
# Copying the file in avoids a multi-ten-minute GitHub download from Aliyun.
COPY ytdlp-assets/ /tmp/ytdlp-assets/
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && arch="$(dpkg --print-architecture)" \
    && case "$arch" in \
         amd64) asset="yt-dlp_linux" ;; \
         arm64) asset="yt-dlp_linux_aarch64" ;; \
         *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
       esac \
    && cp "/tmp/ytdlp-assets/${asset}" /usr/local/bin/yt-dlp \
    && rm -rf /tmp/ytdlp-assets \
    && chmod 755 /usr/local/bin/yt-dlp \
    && yt-dlp --version \
    && ffmpeg -version \
    && node --input-type=module -e "import {spawnSync} from 'node:child_process'; import fs from 'node:fs'; const b=fs.readFileSync('/usr/local/bin/yt-dlp'); if (b[0]!==0x7f||b[1]!==0x45||b[2]!==0x4c||b[3]!==0x46) { console.error('yt-dlp is not a standalone executable'); process.exit(1);} const y=spawnSync('yt-dlp',['--version'],{encoding:'utf8'}); const f=spawnSync('ffmpeg',['-version'],{encoding:'utf8'}); if (y.status!==0||f.status!==0) process.exit(1);" \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY --from=build /app/dist ./dist
ENV DATA_ROOT=/data HOST=0.0.0.0 PORT=8787
VOLUME /data
EXPOSE 8787
CMD ["node", "server/index.mjs"]
