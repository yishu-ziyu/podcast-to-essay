// Streams every request (except audio uploads) to the origin from a fixed
// Vercel region whose egress reaches the Aliyun host; edge rewrites from
// hkg1 lose about half of their connections on the cross-border path.
const http = require('http');

const ORIGIN_HOST = process.env.ORIGIN_HOST || '121.89.90.68';
const ORIGIN_PREFIX = '/lcw';
const SELF_HOST_URL = 'https://github.com/yishu-ziyu/podcast-to-essay';
const CONNECT_TIMEOUT = 4000;
const ATTEMPTS = 2;
const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'proxy-connection', 'te', 'trailer', 'host', 'content-length']);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function open(req, path, body) {
  return new Promise((resolve, reject) => {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!HOP.has(k) && !k.startsWith('x-vercel-')) headers[k] = v;
    }
    headers.host = ORIGIN_HOST;
    headers['x-forwarded-proto'] = 'https';
    headers['x-forwarded-host'] = req.headers.host || '';
    if (body.length) headers['content-length'] = String(body.length);
    const up = http.request({ host: ORIGIN_HOST, port: 80, method: req.method, path: ORIGIN_PREFIX + path, headers });
    const timer = setTimeout(() => up.destroy(new Error('connect timeout')), CONNECT_TIMEOUT);
    up.on('socket', (s) => s.once('connect', () => clearTimeout(timer)));
    up.on('response', (r) => { clearTimeout(timer); resolve(r); });
    up.on('error', (e) => { clearTimeout(timer); reject(e); });
    up.end(body.length ? body : undefined);
  });
}

// Shown to page navigations when the origin cannot be reached, so visitors
// get an explanation and the self-host route instead of a bare 502.
const UNREACHABLE_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>誊清暂时连不上</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f3f1ed; color: #22201e;
    font-family: "DM Sans", "PingFang SC", "Hiragino Sans GB", sans-serif; }
  main { max-width: 440px; padding: 32px 24px; }
  h1 { margin: 0 0 16px; font-family: "Iowan Old Style", "Noto Serif SC", "Songti SC", Georgia, serif;
    font-weight: 400; font-size: 32px; letter-spacing: -.02em; }
  p { margin: 0 0 12px; line-height: 1.7; color: #6f6b66; }
  .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 24px; }
  a, button { font: inherit; font-size: 15px; border-radius: 10px; padding: 10px 18px; cursor: pointer; text-decoration: none; }
  button { border: 1px solid #e3dfd8; background: #fcfbf9; color: #22201e; }
  a { border: 1px solid #b84d1e; background: #b84d1e; color: #fff; }
  a:hover { background: #9f3f15; }
</style>
</head>
<body>
<main>
  <h1>誊清暂时连不上</h1>
  <p>公开站点的服务器在国内，访问要绕经境外线路，这段网络偶尔会断开。过一会儿再刷新，通常就能打开。</p>
  <p>想稳定使用，可以把誊清部署到自己电脑上，导入和转写都在本地进行。</p>
  <div class="actions">
    <button onclick="location.reload()">刷新重试</button>
    <a href="${SELF_HOST_URL}" target="_blank" rel="noreferrer">在 GitHub 上查看自部署方法</a>
  </div>
</main>
</body>
</html>`;

function sendUnreachable(req, res, err) {
  res.statusCode = 502;
  res.setHeader('cache-control', 'no-store');
  if (String(req.headers.accept || '').includes('text/html')) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end(UNREACHABLE_PAGE);
  }
  res.setHeader('content-type', 'application/json; charset=utf-8');
  return res.end(JSON.stringify({
    error: '服务器暂时连不上，请稍后重试。',
    selfHost: SELF_HOST_URL,
    detail: err && err.message,
  }));
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.searchParams.get('__p') || '/';
  url.searchParams.delete('__p');
  const qs = url.searchParams.toString();
  const body = ['GET', 'HEAD'].includes(req.method) ? Buffer.alloc(0) : await readBody(req);
  let upstream, lastErr;
  for (let i = 0; i < ATTEMPTS && !upstream; i++) {
    try { upstream = await open(req, path + (qs ? '?' + qs : ''), body); } catch (e) { lastErr = e; }
  }
  if (!upstream) return sendUnreachable(req, res, lastErr);
  res.statusCode = upstream.statusCode;
  for (const [k, v] of Object.entries(upstream.headers)) {
    if (!HOP.has(k)) res.setHeader(k, v);
  }
  if (String(upstream.headers['content-type'] || '').startsWith('text/event-stream')) {
    res.setHeader('x-accel-buffering', 'no');
    res.flushHeaders();
  }
  upstream.pipe(res);
  req.on('close', () => upstream.destroy());
};
