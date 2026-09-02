# Build frontend
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl \
    && case "$(dpkg --print-architecture)" in \
         arm64) YT_SUFFIX="_aarch64" ;; \
         *) YT_SUFFIX="" ;; \
       esac \
    && curl -L "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp${YT_SUFFIX}" -o /usr/local/bin/yt-dlp \
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
