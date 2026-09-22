import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createAccess } from './access.mjs';
import { corsHeaders, readBody, sendJSON } from './http.mjs';
import { logEvent, redact } from './infrastructure/logger.mjs';
import { handleAuth } from './routes/auth.mjs';
import { handleEpisodes } from './routes/episodes.mjs';
import { handleHealth } from './routes/health.mjs';
import { handleJobs } from './routes/jobs.mjs';
import { createHandlers } from './services/pipeline.mjs';
import { createJobRunner } from './services/job-runner.mjs';
import { createEpisodeStore } from './storage/episode-store.mjs';
import { createJobStore } from './storage/job-store.mjs';
import { createQuotaStore } from './storage/quota-store.mjs';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));

function todayStamp() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, url, dist) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.join(dist, rel);
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const index = path.join(dist, 'index.html');
    if (fs.existsSync(index)) {
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(fs.readFileSync(index));
    }
    return sendJSON(res, 404, { error: 'frontend not built; run `npm run build`' });
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}

export async function startServer() {
  const webDir = path.resolve(SERVER_DIR, '..');
  const root = path.resolve(process.env.DATA_ROOT || path.resolve(SERVER_DIR, '..', '..'));
  try {
    Object.assign(process.env, parseEnv(fs.readFileSync(path.join(root, '.env.local'), 'utf8')));
  } catch { /* dev can run without a local env file */ }

  const paths = {
    root,
    raw: path.join(root, 'raw'),
    cleaned: path.join(root, 'cleaned'),
    ingests: path.join(root, '.ingests'),
    jobs: path.join(root, 'jobs'),
    dist: path.join(webDir, 'dist'),
  };
  for (const dir of [paths.raw, paths.cleaned, paths.ingests, paths.jobs]) fs.mkdirSync(dir, { recursive: true });

  const episodes = createEpisodeStore(paths);
  const jobs = createJobStore(paths.jobs);
  await jobs.load();
  const quota = createQuotaStore(path.join(root, 'quota.json'), {
    ingest: Number(process.env.GUEST_INGEST_PER_DAY || 5),
    transcribe: Number(process.env.GUEST_TRANSCRIBE_PER_DAY || 3),
    clean: Number(process.env.GUEST_CLEAN_PER_DAY || 3),
  }, todayStamp);
  await quota.load();
  const runner = createJobRunner({
    store: jobs,
    handlers: createHandlers({ episodes, ingests: paths.ingests, home: process.env.HOME || '' }),
    log: logEvent,
  });
  await runner.boot((job) => episodes.hasDurableResult(job));

  const ctx = {
    paths,
    episodes,
    jobs,
    quota,
    access: createAccess(process.env.ACCESS_PASSWORD || ''),
    runner,
    readBody,
    maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 512 * 1024 * 1024),
  };
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || '127.0.0.1';
  const dev = process.env.IS_DEV === '1';

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const requestId = req.headers['x-request-id'] && String(req.headers['x-request-id']).length < 80
      ? String(req.headers['x-request-id'])
      : randomUUID();
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          ...corsHeaders(req),
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, x-filename, x-original-name, x-request-id',
        });
        res.end();
        return;
      }
      if (url.pathname.startsWith('/api/') || url.pathname === '/api') {
        ctx.route = { method: req.method, parts: url.pathname.split('/').filter(Boolean), url };
        for (const handle of [handleAuth, handleHealth, handleJobs, handleEpisodes]) {
          const result = await handle(req, res, ctx);
          if (result !== false) break;
        }
        if (!res.headersSent) sendJSON(res, 404, { error: 'not found' });
      } else if (!dev && fs.existsSync(paths.dist)) {
        serveStatic(req, res, url, paths.dist);
      } else if (!res.headersSent) {
        sendJSON(res, 404, { error: 'unknown route', hint: 'dev: use Vite on :5173; prod: build first' });
      }
      logEvent({
        requestId,
        stage: url.pathname,
        durationMs: Date.now() - started,
        result: String(res.statusCode || 0),
      });
    } catch (err) {
      const status = err.status || (err.message === 'request body too large' ? 413 : 500);
      logEvent({
        requestId,
        stage: url.pathname,
        durationMs: Date.now() - started,
        result: String(status),
        errorCode: err.failure?.code || err.code || 'internal_error',
      });
      if (!res.headersSent) sendJSON(res, status, { error: redact(err.message || '服务器内部出错') });
    }
  });

  await new Promise((resolve) => server.listen(port, host, resolve));
  console.log(`[server] podcast-to-essay backend on http://${host}:${port}`);
  const shutdown = () => {
    void runner.stop().finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return server;
}
