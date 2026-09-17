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
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
    && case "$(dpkg --print-architecture)" in \
         arm64) YT_SUFFIX="_aarch64" ;; \
         *) YT_SUFFIX="" ;; \
       esac \
    && curl -L --http1.1 --retry 5 --retry-all-errors "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp${YT_SUFFIX}" -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
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
