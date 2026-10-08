'use strict';

// Portfolio entries client (hub `works/me/portfolios`, talent Bearer). ONE
// entity with a `type` discriminator: EXPERIENCE (work history) vs PORTFOLIO
// (showcase pieces). `experiences` and `portfolios` are the two `?type=` subsets.

const { postJsonWithTimeout } = require('./backend-request');
const { reasonForError } = require('./onboarding-client');

const DEFAULT_TIMEOUT_MS = 20000;
const TYPES = { experiences: 'EXPERIENCE', portfolios: 'PORTFOLIO' };

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

function str(v) {
  return typeof v === 'string' && v ? v : null;
}

// Keep only the human-useful fields (+ id/projectId for --json/tools).
function normalizePortfolio(raw) {
  const it = raw && typeof raw === 'object' ? raw : {};
  const skills = Array.isArray(it.skillIds)
    ? it.skillIds.map((s) => (s && typeof s === 'object' ? str(s.name) : str(s))).filter(Boolean)
    : [];
  return {
    id: str(it.id),
    name: str(it.name),
    company: str(it.clientName),
    startDate: it.startDate ? String(it.startDate) : null,
    endDate: it.endDate ? String(it.endDate) : null,
    isCurrent: it.isCurrent === true,
    location: str(it.location),
    description: str(it.aboutDescription),
    url: str(it.aboutUrl),
    skills,
    projectId: str(it.projectId),
    generatedWith: str(it.generatedWith),
  };
}

async function requestPortfolios({ hubAccessToken } = {}, { endpoint, type, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };
  const url = type ? `${endpoint}${endpoint.includes('?') ? '&' : '?'}type=${encodeURIComponent(type)}` : endpoint;
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
  return { ok: true, items: rows.map(normalizePortfolio) };
}

// `kind` = 'experiences' | 'portfolios' → the matching `type` filter.
async function fetchPortfolios(deps = {}, { hubAccessToken, kind, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const getEndpoint = deps.getMePortfoliosEndpoint || require('./config').getMePortfoliosEndpoint;
  const request = deps.requestPortfolios || requestPortfolios;
  const endpoint = getEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return request({ hubAccessToken }, { endpoint, type: TYPES[kind] || null, timeoutMs });
}

module.exports = {
  TYPES,
  normalizePortfolio,
  requestPortfolios,
  fetchPortfolios,
};
