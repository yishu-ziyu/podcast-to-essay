import { articleConfig } from '../article.mjs';
import { sendJSON } from '../http.mjs';
import { checkReady } from '../infrastructure/dependency-check.mjs';

export async function handleHealth(req, res, ctx) {
  const { method, parts } = ctx.route;
  if (method !== 'GET' || parts[1] !== 'health') return false;
  if (parts[2] === 'live' && parts.length === 3) return sendJSON(res, 200, { ok: true });
  if (parts[2] === 'ready' && parts.length === 3) {
    const ready = await checkReady({ dataRoot: ctx.paths.root, jobsDir: ctx.paths.jobs });
    return sendJSON(res, ready.ok ? 200 : 503, ready);
  }
  if (parts.length !== 2) return false;
  const viewer = ctx.access.viewer(req, res);
  let article = null;
  try {
    const { model } = articleConfig();
    article = { provider: 'stepfun-token-plan', model };
  } catch { /* article engine is optional for the session probe */ }
  return sendJSON(res, 200, {
    ok: true,
    locked: false,
    owner: viewer.owner,
    guest: { limits: ctx.quota.limits, left: ctx.quota.left(ctx.access.quotaKey(viewer)) },
    engine: 'stepfun',
    article,
  });
}
