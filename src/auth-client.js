'use strict';

const { postJsonWithTimeout } = require('./backend-request');

const DEFAULT_TIMEOUT_MS = 20000;
const SIGN_OUT_TIMEOUT_MS = 3000;

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

async function requestAuthToken({ sessionToken } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!sessionToken) return { ok: false, reason: 'no-session-token' };
  const credential = { Authorization: `Bearer ${sessionToken}` };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, null, timeoutMs, 'GET', null, credential);
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: 'http-error', status: res.status };
  const body = parseJson(res.raw);
  const token = body && typeof body.token === 'string' && body.token ? body.token : null;
  if (!token) return { ok: false, reason: 'bad-response', status: res.status };
  return { ok: true, accessToken: token, expiresAt: expiresAtFromJwt(token) };
}

async function requestSignOut({ sessionToken } = {}, { endpoint, timeoutMs = SIGN_OUT_TIMEOUT_MS } = {}) {
  if (!endpoint || !sessionToken) return { ok: false, reason: 'no-credential' };
  const credential = { Authorization: `Bearer ${sessionToken}` };
  try {
    const res = await postJsonWithTimeout(endpoint, {}, timeoutMs, 'POST', null, credential);
    return { ok: res.status >= 200 && res.status < 300, status: res.status };
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
}

module.exports = {
  requestSignOut,
  requestAuthToken,
  expiresAtFromJwt,
  DEFAULT_TIMEOUT_MS,
};
