'use strict';

// On-demand hub-JWT minting for an email (better-auth) session.

const REFRESH_MARGIN_MS = 120 * 1000;
const REVOKED_STATUSES = new Set([401, 403]);

function jwtStillFresh(accessTokenExpiresAt, now, marginMs) {
  const exp = Date.parse(String(accessTokenExpiresAt || ''));
  if (!Number.isFinite(exp)) return false;
  return exp - now > marginMs;
}

async function ensureFreshSession(env = process.env, deps = {}) {
  const {
    loadAuthSession = require('./auth-session-store').loadAuthSession,
    saveAuthSession = require('./auth-session-store').saveAuthSession,
    clearAuthSession = require('./auth-session-store').clearAuthSession,
    getAuthTokenEndpoint = require('./config').getAuthTokenEndpoint,
    requestAuthToken = require('./auth-client').requestAuthToken,
    now = Date.now(),
    marginMs = REFRESH_MARGIN_MS,
  } = deps;

  const session = loadAuthSession(env);
  if (!session) return null;
  if (!session.cookie && !session.sessionToken) return session;
  if (session.accessToken && jwtStillFresh(session.accessTokenExpiresAt, now, marginMs)) return session;

  const endpoint = getAuthTokenEndpoint(env);
  if (!endpoint) return session;

  const tok = await requestAuthToken({ cookie: session.cookie, sessionToken: session.sessionToken }, { endpoint });
  if (!tok.ok && REVOKED_STATUSES.has(tok.status)) {
    clearAuthSession(env);
    return null;
  }
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

function webOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

async function endSession(env = process.env, deps = {}) {
  const {
    loadAuthSession = require('./auth-session-store').loadAuthSession,
    clearAuthSession = require('./auth-session-store').clearAuthSession,
    getSignOutEndpoint = require('./config').getSignOutEndpoint,
    getTalentProfileUrl = require('./config').getTalentProfileUrl,
    requestSignOut = require('./auth-client').requestSignOut,
  } = deps;
  const session = loadAuthSession(env);
  if (session && (session.sessionToken || session.cookie)) {
    await requestSignOut({ cookie: session.cookie, sessionToken: session.sessionToken }, { endpoint: getSignOutEndpoint(env), origin: webOrigin(getTalentProfileUrl(env)) });
  }
  clearAuthSession(env);
  return session !== null;
}

module.exports = { ensureFreshSession, endSession, jwtStillFresh, REFRESH_MARGIN_MS };
