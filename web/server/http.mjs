import { logEvent } from './infrastructure/logger.mjs';

const MAX_JSON_BYTES = 1 * 1024 * 1024;

export function corsOrigin(req) {
  const origin = String(req?.headers?.origin || '');
  if (!origin) return '';
  try {
    const url = new URL(origin);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
      return origin;
    }
  } catch { /* ignore malformed origin */ }
  return '';
}

export function corsHeaders(req) {
  const origin = corsOrigin(req);
  return origin ? { 'Access-Control-Allow-Origin': origin } : {};
}

export function sendJSON(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(res.req),
  });
  res.end(JSON.stringify(obj));
}

export function sendFailure(res, code, failure) {
  logEvent({
    diagnosticId: failure?.diagnosticId || null,
    stage: failure?.stage || null,
    result: String(code),
    errorCode: failure?.code || null,
  });
  sendJSON(res, code, { error: failure.userMessage, failure });
}

export function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let seen = 0;
    req.on('data', (chunk) => {
      seen += chunk.length;
      if (seen > MAX_JSON_BYTES) {
        reject(Object.assign(new Error('request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}
