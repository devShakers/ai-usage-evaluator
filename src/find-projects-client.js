'use strict';

// Find Positions list client (hub `works/positions/find`, talent Bearer). Each
// item carries the parent Project's id/name — a "project" here is the Position's
// parent, not a separate list. Pagination (limit/offset) and filters map to the
// endpoint's `criteria`; the server orders by match desc and returns the total.

const { postJsonWithTimeout } = require('./backend-request');
const { reasonForError } = require('./onboarding-client');

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_LIMIT = 15;
// Only tabs the endpoint distinguishes server-side: All (default order) and
// Saved (savedByMe). "Recommended" was a client illusion — dropped under
// pagination, where it would only cover the fetched page and mislead.
const TABS = ['all', 'saved'];
const ATTENDANCE = { remote: 'REMOTE', hybrid: 'HYBRID', 'in-person': 'IN_PERSON' };

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

function pick(obj, keys) {
  for (const k of keys) {
    const v = obj && obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

function numOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function strArray(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : [];
}

// Only fields the readview's criteria map supports server-side: savedByMe,
// attendance, country, clusterIds (confirmed in FindPositionsService + its prisma readview).
// languages and skills are output-only (no filter field) → not built here.
function buildCriteria(tab, { limit = DEFAULT_LIMIT, offset = 0, attendance = null, country = null, clusterId = null } = {}) {
  const criteria = { limit, offset };
  const conditions = [];
  if (tab === 'saved') conditions.push({ field: 'savedByMe', operator: 'EQUALS', value: true });
  if (clusterId) conditions.push({ field: 'clusterIds', operator: 'IN', value: [clusterId] });
  if (attendance) conditions.push({ field: 'attendance', operator: 'IN', value: [attendance] });
  if (country) conditions.push({ field: 'country', operator: 'IN', value: [country] });
  if (conditions.length) criteria.filter = { conjunction: 'AND', conditions };
  return criteria;
}

function normalizeItem(raw) {
  const it = raw && typeof raw === 'object' ? raw : {};
  const company = it.company && typeof it.company === 'object' ? it.company : {};
  const budget = it.budget && typeof it.budget === 'object' ? it.budget : null;
  return {
    positionId: pick(it, ['positionId', 'id']),
    title: pick(it, ['title']),
    projectId: pick(it, ['projectId']),
    projectName: pick(it, ['projectName']),
    description: pick(it, ['description']),
    country: pick(it, ['country']),
    requiredMonthlyHours: numOrNull(it.requiredMonthlyHours),
    attendance: pick(it, ['attendance']),
    match: numOrNull(it.match),
    isSaved: it.isSaved === true,
    company: {
      name: pick(company, ['name']),
      restricted: company.restricted === true,
    },
    budget: budget
      ? {
        from: numOrNull(budget.from),
        to: numOrNull(budget.to),
        unit: pick(budget, ['unit']),
        display: pick(budget, ['display']),
      }
      : null,
    skillNames: strArray(it.skillNames),
    languages: strArray(it.languages),
  };
}

async function requestFindProjects(
  { hubAccessToken } = {},
  { tab = 'all', endpoint, timeoutMs = DEFAULT_TIMEOUT_MS, limit = DEFAULT_LIMIT, offset = 0, attendance = null, country = null, clusterId = null } = {},
) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };

  const criteria = buildCriteria(tab, { limit, offset, attendance, country, clusterId });
  const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}criteria=${encodeURIComponent(JSON.stringify(criteria))}`;
  let res;
  try {
    res = await postJsonWithTimeout(url, null, timeoutMs, 'GET', null, bearerHeaders(hubAccessToken));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };

  const env = parseJson(res.raw);
  if (!env || typeof env !== 'object') return { ok: false, reason: 'bad-response' };
  const data = env.status === 'OK' ? env.data : env;
  const rows = Array.isArray(data) ? data : (Array.isArray(data && data.items) ? data.items : null);
  if (!rows) return { ok: false, reason: 'bad-response' };
  return { ok: true, items: rows.map(normalizeItem), meta: (env && typeof env.meta === 'object' ? env.meta : null) };
}

// CLI+MCP entry: resolve the endpoint from config, then fetch one page.
async function fetchFindProjects(deps = {}, { hubAccessToken, tab = 'all', timeoutMs = DEFAULT_TIMEOUT_MS, limit = DEFAULT_LIMIT, offset = 0, attendance = null, country = null, clusterId = null } = {}) {
  const {
    getFindPositionsEndpoint = require('./config').getFindPositionsEndpoint,
    requestFindProjects: request = requestFindProjects,
  } = deps;
  const endpoint = getFindPositionsEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return request({ hubAccessToken }, { tab, endpoint, timeoutMs, limit, offset, attendance, country, clusterId });
}

// Open positions visible to the talent that look for one role (cluster): the list's own total, one row fetched.
async function countOpenPositions(deps = {}, { hubAccessToken, clusterId, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const res = await fetchFindProjects(deps, { hubAccessToken, timeoutMs, limit: 1, clusterId });
  if (!res.ok) return res;
  const total = res.meta && Number.isInteger(res.meta.total) ? res.meta.total : null;
  return total === null ? { ok: false, reason: 'no-total' } : { ok: true, total };
}

module.exports = {
  TABS,
  countOpenPositions,
  ATTENDANCE,
  DEFAULT_LIMIT,
  buildCriteria,
  normalizeItem,
  requestFindProjects,
  fetchFindProjects,
};
