'use strict';

// Static-data i18n resolver. The hub stores skill (and other static-data) names
// as KEYS (staticDataSkillsSkill_N); `GET translations?namespace=static-data`
// returns every key with its per-language text. We fetch it ONCE (cached per
// language for the process — MCP is long-lived) and resolve keys to names.

const { postJsonWithTimeout } = require('./backend-request');
const { reasonForError } = require('./onboarding-client');

const DEFAULT_TIMEOUT_MS = 20000;
const cache = new Map(); // langKey -> Map(key -> text)

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

async function requestTranslations({ hubAccessToken } = {}, { endpoint, namespace = 'static-data', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };
  const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}namespace=${encodeURIComponent(namespace)}`;
  let res;
  try {
    res = await postJsonWithTimeout(url, null, timeoutMs, 'GET', null, bearerHeaders(hubAccessToken));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };
  const env = parseJson(res.raw);
  const data = env && env.status === 'OK' ? env.data : env;
  const rows = Array.isArray(data) ? data : (Array.isArray(data && data.items) ? data.items : null);
  if (!rows) return { ok: false, reason: 'bad-response' };
  return { ok: true, rows };
}

// Returns `{ ok, map }`. On failure `map` is null (callers degrade to the raw
// value rather than blocking the whole listing on a translations outage).
async function fetchTranslationMap(deps = {}, { hubAccessToken, lang = 'en', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const key = lang === 'es' ? 'es' : 'en';
  if (cache.has(key)) return { ok: true, map: cache.get(key) };
  const getEndpoint = deps.getTranslationsEndpoint || require('./config').getTranslationsEndpoint;
  const request = deps.requestTranslations || requestTranslations;
  const endpoint = getEndpoint();
  if (!endpoint) return { ok: false, map: null, reason: 'no-endpoint' };
  const res = await request({ hubAccessToken }, { endpoint, timeoutMs });
  if (!res.ok) return { ok: false, map: null, reason: res.reason };
  const map = new Map();
  for (const r of res.rows) {
    if (r && typeof r.key === 'string') {
      const text = r[key] || r.en || r.es || null;
      if (text) map.set(r.key, text);
    }
  }
  cache.set(key, map);
  return { ok: true, map };
}

// Resolve a name: if the map holds it (a static-data key) -> readable text;
// otherwise return it unchanged (already-plain names, or unknown keys).
function resolveName(map, name) {
  if (!name || !map) return name;
  return map.has(name) ? map.get(name) : name;
}

function clearCache() {
  cache.clear();
}

module.exports = {
  requestTranslations,
  fetchTranslationMap,
  resolveName,
  clearCache,
};
