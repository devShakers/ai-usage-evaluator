'use strict';

const { postJsonWithTimeout } = require('./backend-request');
const { reasonForError, WORKS_CODE_TO_REASON } = require('./skills-client');

// Talent-agent client for `start`'s "Add agent" route (talents-ai-score Phase 2).

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

// DIRECT-to-Hub headers (the relate route is not a certs relay): the Talent's own hub token IS the Authorization, same shape as portfolio-client's own `hubHeaders`.
function hubHeaders({ hubAccessToken } = {}) {
  const headers = {};
  if (typeof hubAccessToken === 'string' && hubAccessToken) headers.Authorization = `Bearer ${hubAccessToken}`;
  return headers;
}

// `GET .../agents` -> { ok, agents:[{name}] } | { ok:false, reason }. Used for
// client-side dedup; a failed list is a named reason, never a silent skip.
async function requestListAgents({ accessToken, hubAccessToken } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
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

  const agents = data
    .map((entry) => ({
      name: entry && typeof entry.name === 'string' ? entry.name : null,
      id: entry && (typeof entry.id === 'string' || typeof entry.id === 'number') ? String(entry.id) : null,
    }))
    .filter((a) => a.name !== null);
  return { ok: true, agents };
}

// `POST .../agents/declare`. `no-hub-token` fires locally before any request.
// Optional fields are OMITTED (never null/empty).
async function requestDeclareAgent(
  { name, catalogId, whatItDoes, humanDecides, accessToken, hubAccessToken } = {},
  { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };

  const body = { name };
  // Hub's `catalogId` is an Int `num_id` (`@IsInt()` server-side).
  if (typeof catalogId === 'number' && Number.isInteger(catalogId)) body.catalogId = catalogId;
  if (typeof whatItDoes === 'string' && whatItDoes) body.whatItDoes = whatItDoes;
  if (typeof humanDecides === 'string' && humanDecides) body.humanDecides = humanDecides;

  let res;
  try {
    res = await postJsonWithTimeout(endpoint, body, timeoutMs, 'POST', null, authHeaders({ accessToken, hubAccessToken }));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }

  if (res.status < 200 || res.status >= 300) {
    if (res.status === 409) return { ok: false, reason: 'agent-exists' };
    return { ok: false, reason: reasonForError(res.status, res.raw) };
  }

  const json = parseJson(res.raw);
  if (!json || json.status !== 'OK') return { ok: false, reason: 'bad-response' };
  // Thread the created agent's id back (relayed from Hub's declare response) so the relate step can PATCH `.../agents/:id/portfolios` (ADR-041).
  const data = json.data && typeof json.data === 'object' ? json.data : null;
  const rawId = data ? data.id : null;
  const agentId = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : null;
  return { ok: true, agentId };
}

// `PATCH {hub}/works/me/agents/:id/portfolios` — DIRECT to Hub (ADR-041), replace-set.
async function requestRelateAgentPortfolios(
  { agentId, items, hubAccessToken } = {},
  { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };
  if (!agentId) return { ok: false, reason: 'no-agent' };

  const body = {
    items: (Array.isArray(items) ? items : []).map((it) => ({ portfolioId: it && it.portfolioId })),
  };

  let res;
  try {
    res = await postJsonWithTimeout(endpoint, body, timeoutMs, 'PATCH', null, hubHeaders({ hubAccessToken }));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }

  if (res.status < 200 || res.status >= 300) {
    return { ok: false, reason: reasonForError(res.status, res.raw) };
  }
  const json = parseJson(res.raw);
  if (!json || (json.success !== true && json.status !== 'OK')) return { ok: false, reason: 'bad-response' };
  return { ok: true };
}

// `POST .../agents/draft-fields` -> { ok, whatItDoes, humanDecides } | { ok:false, reason }.
// No X-Hub-Token. The CALLER gates consent (ADR-052), so `consent:true` is always sent.
async function requestDraftAgentFields(
  { name, tools, model, parent, definition, accessToken } = {},
  { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };

  const body = { consent: true, name };
  if (Array.isArray(tools) && tools.length > 0) body.tools = tools.filter((t) => typeof t === 'string' && t);
  if (typeof model === 'string' && model) body.model = model;
  if (typeof parent === 'string' && parent) body.parent = parent;
  if (typeof definition === 'string' && definition) body.definition = definition;

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
  const data = json && json.status === 'OK' && json.data && typeof json.data === 'object' ? json.data : null;
  const whatItDoes = data && typeof data.whatItDoes === 'string' ? data.whatItDoes : null;
  const humanDecides = data && typeof data.humanDecides === 'string' ? data.humanDecides : null;
  if (!whatItDoes || !humanDecides) return { ok: false, reason: 'bad-response' };
  return { ok: true, whatItDoes, humanDecides };
}

module.exports = {
  requestListAgents,
  requestDeclareAgent,
  requestRelateAgentPortfolios,
  requestDraftAgentFields,
  WORKS_CODE_TO_REASON,
};
