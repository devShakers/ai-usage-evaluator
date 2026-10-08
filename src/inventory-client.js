'use strict';

const { postJsonWithTimeout } = require('./backend-request');

const DEFAULT_TIMEOUT_MS = 20000;

function parseJson(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function authHeaders({ accessToken } = {}) {
  const headers = {};
  if (typeof accessToken === 'string' && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

function normalizeSkill(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const skillId = typeof entry.skillId === 'number' ? entry.skillId : null;
  const skillName = typeof entry.skillName === 'string' ? entry.skillName : null;
  if (skillId === null || !skillName) return null;
  const technologies = Array.isArray(entry.technologies)
    ? entry.technologies.filter((tech) => typeof tech === 'string' && tech)
    : [];
  return { skillId, skillName, technologies };
}

function normalizeAgent(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const name = typeof entry.name === 'string' ? entry.name : null;
  if (!name) return null;
  const tools = Array.isArray(entry.tools)
    ? entry.tools.filter((tool) => typeof tool === 'string' && tool)
    : [];
  const model = typeof entry.model === 'string' && entry.model ? entry.model : null;
  const category = typeof entry.category === 'string' && entry.category ? entry.category : null;
  const role = typeof entry.role === 'string' && entry.role ? entry.role : null;
  const level = typeof entry.level === 'string' && entry.level ? entry.level : null;
  const code = typeof entry.code === 'string' && entry.code ? entry.code : null;
  const whatItDoes = typeof entry.whatItDoes === 'string' && entry.whatItDoes ? entry.whatItDoes : null;
  const method = typeof entry.method === 'string' && entry.method ? entry.method : null;
  return { name, tools, model, category, role, level, code, whatItDoes, method };
}

async function requestDiscoveredInventory({ accessToken } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };

  let res;
  try {
    res = await postJsonWithTimeout(endpoint, null, timeoutMs, 'GET', null, authHeaders({ accessToken }));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }

  if (res.status === 404) return { ok: false, reason: 'no-inventory' };
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, reason: `http-${res.status}` };
  }

  const json = parseJson(res.raw);
  const data = json && typeof json === 'object' ? json.data : null;
  if (!data || typeof data !== 'object') return { ok: false, reason: 'bad-response' };

  const skills = (Array.isArray(data.skills) ? data.skills : []).map(normalizeSkill).filter(Boolean);
  const agents = (Array.isArray(data.agents) ? data.agents : []).map(normalizeAgent).filter(Boolean);
  return { ok: true, skills, agents };
}

// Same read, but a `http-401` (expired hub JWT — certs validates it via hub JWKS)
// triggers one token refresh and a single retry, so an expired token never breaks the
// inventory read (add-agent / list_addable). `request` is injectable for tests.
async function requestDiscoveredInventoryWithRefresh(
  { accessToken, refreshToken } = {},
  { endpoint, timeoutMs, request = requestDiscoveredInventory } = {},
) {
  let res = await request({ accessToken }, { endpoint, timeoutMs });
  if (res && res.reason === 'http-401' && typeof refreshToken === 'function') {
    let fresh = null;
    try { fresh = await refreshToken(); } catch { fresh = null; }
    const nextToken = fresh && (fresh.accessToken || fresh.hubAccessToken);
    if (nextToken) res = await request({ accessToken: nextToken }, { endpoint, timeoutMs });
  }
  return res;
}

module.exports = { requestDiscoveredInventory, requestDiscoveredInventoryWithRefresh };
