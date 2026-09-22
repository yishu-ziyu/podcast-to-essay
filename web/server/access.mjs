import { randomUUID } from 'node:crypto';

export function createAccess(password) {
  const sessions = new Set();

  function sessionId(req) {
    const match = String(req.headers.cookie || '').match(/(?:^|;\s*)p2e_session=([^;]+)/);
    return match ? match[1] : '';
  }

  function isOwner(req) {
    return !password || sessions.has(sessionId(req));
  }

  function guestId(req, res) {
    const match = String(req.headers.cookie || '').match(/(?:^|;\s*)p2e_guest=([^;]+)/);
    if (match) return match[1];
    const id = randomUUID();
    res.setHeader('Set-Cookie', `p2e_guest=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`);
    return id;
  }

  function clientIp(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    return forwarded[0] || String(req.headers['x-real-ip'] || '').trim() || req.socket.remoteAddress || '';
  }

  function viewer(req, res) {
    const owner = isOwner(req);
    const gid = guestId(req, res);
    return { owner, guestId: gid, ip: clientIp(req), tag: owner ? 'user' : `guest:${gid}` };
  }

  return {
    isOwner,
    viewer,
    quotaKey: (who) => `${who.ip}|${who.guestId}`,
    login(attempt) {
      if (!password) return { ok: true, locked: false, token: '' };
      if (String(attempt || '') !== password) return null;
      const token = randomUUID();
      sessions.add(token);
      return { ok: true, locked: true, token };
    },
    logout(req) {
      sessions.delete(sessionId(req));
    },
  };
}
