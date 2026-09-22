import { sendJSON } from '../http.mjs';

export async function handleAuth(req, res, ctx) {
  const { method, parts } = ctx.route;
  if (method === 'POST' && parts[1] === 'login' && parts.length === 2) {
    const body = await ctx.readBody(req);
    const session = ctx.access.login(body.password);
    if (!session) return sendJSON(res, 401, { error: '密码不对' });
    if (session.token) res.setHeader('Set-Cookie', `p2e_session=${session.token}; Path=/; HttpOnly; SameSite=Lax`);
    return sendJSON(res, 200, { ok: true, locked: session.locked });
  }
  if (method === 'POST' && parts[1] === 'logout' && parts.length === 2) {
    ctx.access.logout(req);
    res.setHeader('Set-Cookie', 'p2e_session=; Path=/; Max-Age=0');
    return sendJSON(res, 200, { ok: true });
  }
  return false;
}
