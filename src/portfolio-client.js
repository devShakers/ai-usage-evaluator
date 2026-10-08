'use strict';

const { postJsonWithTimeout, postMultipartWithTimeout } = require('./backend-request');
const { reasonForError, WORKS_CODE_TO_REASON } = require('./skills-client');

// Talent-portfolio client (talents-ai-score, ADR-059 — `start`'s "Add project to portfolio" route, src/start-add-portfolio.js).

const DEFAULT_TIMEOUT_MS = 20000;

function parseJson(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function authHeaders({ accessToken, hubAccessToken } = {}) {
  const headers = {};
  if (typeof accessToken === 'string' && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (typeof hubAccessToken === 'string' && hubAccessToken) headers['X-Hub-Token'] = hubAccessToken;
  return headers;
}

function hubHeaders({ hubAccessToken } = {}) {
  const headers = {};
  if (typeof hubAccessToken === 'string' && hubAccessToken) headers.Authorization = `Bearer ${hubAccessToken}`;
  return headers;
}

// `GET .../portfolios`.
async function requestListPortfolios({ accessToken, hubAccessToken } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };

  let res;
  try {
    res = await postJsonWithTimeout(endpoint, null, timeoutMs, 'GET', null, authHeaders({ accessToken, hubAccessToken }));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }

  if (res.status < 200 || res.status >= 300) {
    return { ok: false, reason: reasonForError(res.status, res.raw) };
  }

  const json = parseJson(res.raw);
  const data = json && typeof json === 'object' && Array.isArray(json.data) ? json.data : null;
  if (!data) return { ok: false, reason: 'bad-response' };

  const portfolios = data
    .map((entry) => ({
      id: entry && typeof entry.id === 'string' ? entry.id : null,
      name: entry && typeof entry.name === 'string' ? entry.name : null,
      type: entry && typeof entry.type === 'string' ? entry.type : null,
      skillIds: entry && Array.isArray(entry.skillIds) ? entry.skillIds : [],
      startDate: entry && typeof entry.startDate === 'string' ? entry.startDate : null,
      endDate: entry && typeof entry.endDate === 'string' ? entry.endDate : null,
      isCurrent: entry ? entry.isCurrent === true : false,
    }))
    .filter((p) => p.name !== null);
  return { ok: true, portfolios };
}

// `POST .../portfolios/declare`.
async function requestDeclarePortfolio(
  { name, type, skillIds, description, url, clientName, clientDomain, startDate, endDate, accessToken, hubAccessToken } = {},
  { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };

  const body = { name, type };
  if (Array.isArray(skillIds) && skillIds.length > 0) body.skillIds = skillIds;
  if (typeof description === 'string' && description) body.description = description;
  if (typeof url === 'string' && url) body.url = url;
  if (typeof clientName === 'string' && clientName) body.clientName = clientName;
  if (typeof clientDomain === 'string' && clientDomain) body.clientDomain = clientDomain;
  if (typeof startDate === 'string' && startDate) body.startDate = startDate;
  if (typeof endDate === 'string' && endDate) body.endDate = endDate;
  body.generatedWith = 'AI';

  let res;
  try {
    res = await postJsonWithTimeout(endpoint, body, timeoutMs, 'POST', null, authHeaders({ accessToken, hubAccessToken }));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }

  if (res.status < 200 || res.status >= 300) {
    return { ok: false, reason: reasonForError(res.status, res.raw) };
  }

  const json = parseJson(res.raw);
  if (!json || json.status !== 'OK') return { ok: false, reason: 'bad-response' };
  return { ok: true };
}

// `POST .../portfolios/draft-description`.
async function requestDraftDescription(
  { name, technologies, readme, packageDescription, accessToken } = {},
  { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };

  const body = {
    consent: true,
    name,
    technologies: Array.isArray(technologies) ? technologies.filter((t) => typeof t === 'string' && t) : [],
  };
  if (typeof readme === 'string' && readme) body.readme = readme;
  if (typeof packageDescription === 'string' && packageDescription) body.packageDescription = packageDescription;

  let res;
  try {
    res = await postJsonWithTimeout(endpoint, body, timeoutMs, 'POST', null, authHeaders({ accessToken }));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }

  if (res.status < 200 || res.status >= 300) {
    return { ok: false, reason: reasonForError(res.status, res.raw) };
  }

  const json = parseJson(res.raw);
  const description = json && json.status === 'OK' && json.data && typeof json.data.description === 'string'
    ? json.data.description
    : null;
  if (!description) return { ok: false, reason: 'bad-response' };
  return { ok: true, description };
}

async function requestUpdatePortfolioSkills(
  { portfolioId, skillIds, hubAccessToken } = {},
  { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };
  if (!portfolioId) return { ok: false, reason: 'no-portfolio' };

  const url = `${endpoint.replace(/\/+$/, '')}/${encodeURIComponent(portfolioId)}`;
  const fields = { skillIds: (Array.isArray(skillIds) ? skillIds : []).join(',') };
  let res;
  try {
    res = await postMultipartWithTimeout(url, fields, timeoutMs, 'PATCH', hubHeaders({ hubAccessToken }));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }

  if (res.status < 200 || res.status >= 300) {
    return { ok: false, reason: reasonForError(res.status, res.raw) };
  }
  const json = parseJson(res.raw);
  if (!json || json.status !== 'OK') return { ok: false, reason: 'bad-response' };
  return { ok: true };
}

module.exports = {
  requestListPortfolios,
  requestDeclarePortfolio,
  requestDraftDescription,
  requestUpdatePortfolioSkills,
  WORKS_CODE_TO_REASON,
};
