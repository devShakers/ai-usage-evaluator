'use strict';

// GET hub `works/me/ai-profile` — the same read model the "My work with AI" front
// paints: { setup, usage, cell, isAiNative, traction, vision, howIWork }.

const { postJsonWithTimeout } = require('./backend-request');

const DEFAULT_TIMEOUT_MS = 20000;

function parseJson(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function authHeaders(token) {
  const headers = {};
  if (typeof token === 'string' && token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function requestAiProfile({ accessToken, hubAccessToken } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  const token = hubAccessToken || accessToken;

  let res;
  try {
    res = await postJsonWithTimeout(endpoint, null, timeoutMs, 'GET', null, authHeaders(token));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }

  // 404 = no profile row yet (projection hasn't landed) — a retriable "not ready".
  if (res.status === 404) return { ok: false, reason: 'not-found' };
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: `http-${res.status}` };

  const json = parseJson(res.raw);
  const data = json && typeof json === 'object' ? json.data : null;
  if (!data || typeof data !== 'object') return { ok: false, reason: 'bad-response' };
  return { ok: true, profile: data };
}

module.exports = { requestAiProfile };
