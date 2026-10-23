'use strict';

const { loadAuthSession, sessionStatus } = require('./auth-session-store');
const { ensureFreshSession } = require('./session-refresh');

function jwtUsable(session, now) {
  const exp = Date.parse(String((session && session.accessTokenExpiresAt) || ''));
  return Number.isFinite(exp) && exp > now;
}

async function hasUsableSession(env = process.env, deps = {}) {
  const {
    loadAuthSession: load = loadAuthSession,
    ensureFreshSession: refresh = ensureFreshSession,
    now = Date.now(),
  } = deps;

  const session = load(env);
  if (sessionStatus(session, now) === 'active') return true;
  if (!session || !session.sessionToken) return false;

  let refreshed = null;
  try { refreshed = await refresh(env, { now }); } catch { refreshed = null; }
  return jwtUsable(refreshed || load(env), now);
}

module.exports = { hasUsableSession, jwtUsable };
