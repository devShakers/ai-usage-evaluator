'use strict';

// Social links client. VIEW = GET `works/me/social`; SET = PUT the same endpoint
// (upsert of the WHOLE object — a fixed set of named URL fields, not per-link rows).

const { postJsonWithTimeout } = require('./backend-request');
const { reasonForError } = require('./onboarding-client');

const DEFAULT_TIMEOUT_MS = 20000;
const NETWORKS = ['linkedin', 'github', 'website', 'twitter', 'instagram', 'facebook', 'dribbble', 'behance'];

function parseJson(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function bearerHeaders(accessToken) {
  const headers = {};
  if (typeof accessToken === 'string' && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

function normalizeSocial(data) {
  const it = data && typeof data === 'object' ? data : {};
  const out = {};
  for (const k of NETWORKS) out[k] = typeof it[k] === 'string' && it[k] ? it[k] : null;
  return out;
}

async function requestSocials({ hubAccessToken } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, null, timeoutMs, 'GET', null, bearerHeaders(hubAccessToken));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  // No social section yet is a normal empty state, not an error.
  if (res.status === 404) return { ok: true, social: normalizeSocial({}) };
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };
  const env = parseJson(res.raw);
  const data = env && env.status === 'OK' ? env.data : env;
  if (!data || typeof data !== 'object') return { ok: false, reason: 'bad-response' };
  return { ok: true, social: normalizeSocial(data) };
}

// Upsert the WHOLE object: `social` carries every network (value or null).
async function requestSetSocials({ hubAccessToken, social } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };
  if (!social || typeof social !== 'object') return { ok: false, reason: 'no-social' };
  const body = {};
  for (const k of NETWORKS) body[k] = typeof social[k] === 'string' && social[k] ? social[k] : null;
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, body, timeoutMs, 'PUT', null, bearerHeaders(hubAccessToken));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };
  return { ok: true };
}

async function fetchSocials(deps = {}, { hubAccessToken, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const getEndpoint = deps.getMeSocialEndpoint || require('./config').getMeSocialEndpoint;
  const request = deps.requestSocials || requestSocials;
  const endpoint = getEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return request({ hubAccessToken }, { endpoint, timeoutMs });
}

async function saveSocials(deps = {}, { hubAccessToken, social, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const getEndpoint = deps.getMeSocialEndpoint || require('./config').getMeSocialEndpoint;
  const request = deps.requestSetSocials || requestSetSocials;
  const endpoint = getEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return request({ hubAccessToken, social }, { endpoint, timeoutMs });
}

module.exports = {
  NETWORKS,
  normalizeSocial,
  requestSocials,
  requestSetSocials,
  fetchSocials,
  saveSocials,
};
