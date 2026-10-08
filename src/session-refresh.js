'use strict';

// On-demand hub-JWT minting for an email (better-auth) session.

const REFRESH_MARGIN_MS = 120 * 1000;

function jwtStillFresh(accessTokenExpiresAt, now, marginMs) {
  const exp = Date.parse(String(accessTokenExpiresAt || ''));
  if (!Number.isFinite(exp)) return false;
  return exp - now > marginMs;
}

async function ensureFreshSession(env = process.env, deps = {}) {
  const {
    loadAuthSession = require('./auth-session-store').loadAuthSession,
    saveAuthSession = require('./auth-session-store').saveAuthSession,
    getAuthTokenEndpoint = require('./config').getAuthTokenEndpoint,
    requestAuthToken = require('./auth-client').requestAuthToken,
    now = Date.now(),
    marginMs = REFRESH_MARGIN_MS,
  } = deps;

  const session = loadAuthSession(env);
  if (!session) return null;
  if (!session.cookie) return session;
  if (session.accessToken && jwtStillFresh(session.accessTokenExpiresAt, now, marginMs)) return session;

  const endpoint = getAuthTokenEndpoint(env);
  if (!endpoint) return session;

  const tok = await requestAuthToken({ cookie: session.cookie }, { endpoint });
  if (!tok.ok) return session;

  try {
    saveAuthSession(
      {
        ...session,
        accessToken: tok.accessToken,
        hubAccessToken: tok.accessToken,
        accessTokenExpiresAt: tok.expiresAt,
        cookieExpiresAt: session.expiresAt,
      },
      env,
    );
  } catch {
    return session;
  }
  return loadAuthSession(env);
}

module.exports = { ensureFreshSession, jwtStillFresh, REFRESH_MARGIN_MS };
