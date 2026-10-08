'use strict';

const { postJsonWithTimeout, extractSetCookie } = require('./backend-request');

// Login / token acquisition against the Hub's better-auth email engine (owner decision, supersedes ADR-031 for the email path).

const DEFAULT_TIMEOUT_MS = 20000;
const SESSION_COOKIE_NAME = 'better-auth.session_token';
// Refresh the cookie session's own validity from the Set-Cookie Max-Age; fall
// back to 7 days (better-auth's default) when the attribute is absent.
const DEFAULT_COOKIE_TTL_SECONDS = 7 * 24 * 60 * 60;

function parseJson(raw) {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

// `exp` (JWT seconds) -> ISO, or null. Never throws.
function expiresAtFromJwt(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const exp = typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp : null;
    return exp === null ? null : new Date(exp * 1000).toISOString();
  } catch {
    return null;
  }
}

// ISO expiry for the session cookie, read from the Set-Cookie `Max-Age` (or
// `Expires`) of the named cookie; defaults to +7 days when neither is present.
function cookieExpiresAtFromHeaders(headers, name = SESSION_COOKIE_NAME) {
  const raw = headers && headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : (typeof raw === 'string' && raw ? [raw] : []);
  // Match the base name with or without better-auth's HTTPS `__Secure-`/`__Host-` prefixes.
  const names = [name, `__Secure-${name}`, `__Host-${name}`];
  const entry = list.find((e) => typeof e === 'string' && names.some((n) => e.startsWith(`${n}=`)));
  if (entry) {
    const maxAge = /(?:^|;\s*)max-age=(\d+)/i.exec(entry);
    if (maxAge) return new Date(Date.now() + Number(maxAge[1]) * 1000).toISOString();
    const expires = /(?:^|;\s*)expires=([^;]+)/i.exec(entry);
    if (expires) {
      const t = Date.parse(expires[1]);
      if (Number.isFinite(t)) return new Date(t).toISOString();
    }
  }
  return new Date(Date.now() + DEFAULT_COOKIE_TTL_SECONDS * 1000).toISOString();
}

function normalizeResponse(status, raw) {
  if (status >= 200 && status < 300) {
    let json = null;
    try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
    const payload = json && typeof json.data === 'object' && json.data !== null ? json.data : json;
    const accessToken = payload && typeof payload.accessToken === 'string' && payload.accessToken ? payload.accessToken : null;
    if (!accessToken) return { ok: false, reason: 'bad-response', status };
    const expiresAt = payload && typeof payload.expiresAt === 'string' && payload.expiresAt ? payload.expiresAt : null;
    const emailRaw = payload && (payload.userEmail || payload.email);
    const email = typeof emailRaw === 'string' && emailRaw ? emailRaw : null;
    const hubAccessToken = payload && typeof payload.hubAccessToken === 'string' && payload.hubAccessToken ? payload.hubAccessToken : null;
    return { ok: true, accessToken, expiresAt, email, hubAccessToken };
  }
  if (status === 401) return { ok: false, reason: 'invalid-credentials', status };
  if (status === 409 || status === 422) return { ok: false, reason: 'no-email-password', status };
  if (status === 502 || status === 503) return { ok: false, reason: 'upstream', status };
  return { ok: false, reason: 'http-error', status };
}

// Maps the sign-in POST outcome to a captured cookie + email, or a named reason.
function normalizeSignIn(status, raw, headers) {
  if (status >= 200 && status < 300) {
    const cookie = extractSetCookie(headers, SESSION_COOKIE_NAME);
    if (!cookie) return { ok: false, reason: 'bad-response', status };
    const body = parseJson(raw);
    const user = body && typeof body === 'object' ? body.user : null;
    const emailRaw = user && typeof user.email === 'string' ? user.email : null;
    return {
      ok: true,
      cookie,
      cookieExpiresAt: cookieExpiresAtFromHeaders(headers),
      email: emailRaw || null,
    };
  }
  if (status === 401) return { ok: false, reason: 'invalid-credentials', status };
  if (status === 409 || status === 422) return { ok: false, reason: 'no-email-password', status };
  if (status === 502 || status === 503) return { ok: false, reason: 'upstream', status };
  return { ok: false, reason: 'http-error', status };
}

// Mints a hub JWT from a better-auth session cookie: `GET {tokenEndpoint}` with the `Cookie` header.
async function requestAuthToken({ cookie } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!cookie) return { ok: false, reason: 'no-cookie' };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, null, timeoutMs, 'GET', null, { Cookie: cookie });
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: 'http-error', status: res.status };
  const body = parseJson(res.raw);
  const token = body && typeof body.token === 'string' && body.token ? body.token : null;
  if (!token) return { ok: false, reason: 'bad-response', status: res.status };
  return { ok: true, accessToken: token, expiresAt: expiresAtFromJwt(token) };
}

// The full email login: sign-in (capture cookie) -> mint JWT.
async function requestLogin(
  { email, password },
  { signInEndpoint, tokenEndpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!signInEndpoint) return { ok: false, reason: 'no-endpoint' };
  let signIn;
  try {
    const { status, raw, headers } = await postJsonWithTimeout(signInEndpoint, { email, password }, timeoutMs);
    signIn = normalizeSignIn(status, raw, headers);
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'local-error' };
  }
  if (!signIn.ok) return signIn;

  const tok = await requestAuthToken({ cookie: signIn.cookie }, { endpoint: tokenEndpoint, timeoutMs });
  if (!tok.ok) return { ok: false, reason: 'token-fetch-failed', status: tok.status || null };

  return {
    ok: true,
    accessToken: tok.accessToken,
    hubAccessToken: tok.accessToken,
    expiresAt: tok.expiresAt,
    email: signIn.email || (typeof email === 'string' ? email : null),
    cookie: signIn.cookie,
    cookieExpiresAt: signIn.cookieExpiresAt,
  };
}

module.exports = {
  requestLogin,
  requestAuthToken,
  normalizeSignIn,
  normalizeResponse,
  expiresAtFromJwt,
  SESSION_COOKIE_NAME,
  DEFAULT_TIMEOUT_MS,
};
