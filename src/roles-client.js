'use strict';

// Role/cluster hub clients (talent Bearer): list the addable catalog, list the
// talent's own assigned roles, add a GROWTH role, and set the MAIN role.

const { postJsonWithTimeout } = require('./backend-request');
const { reasonForError } = require('./onboarding-client');

const DEFAULT_TIMEOUT_MS = 20000;

function parseJson(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function envelopeData(raw) {
  const json = parseJson(raw);
  if (!json || typeof json !== 'object') return undefined;
  return json.status === 'OK' ? json.data : json;
}

function bearerHeaders(hubAccessToken) {
  const headers = {};
  if (typeof hubAccessToken === 'string' && hubAccessToken) headers.Authorization = `Bearer ${hubAccessToken}`;
  return headers;
}

function normalizeRole(r) {
  if (!r || typeof r !== 'object') return null;
  const clusterId = typeof r.clusterId === 'string' ? r.clusterId : null;
  if (!clusterId) return null;
  return {
    clusterId,
    // Hub's assigned-clusters rows name the role in clusterName.
    name: typeof r.name === 'string' ? r.name : (typeof r.clusterName === 'string' ? r.clusterName : null),
    category: typeof r.category === 'string' ? r.category : null,
    proposalKind: typeof r.proposalKind === 'string' ? r.proposalKind : null,
    type: typeof r.type === 'string' ? r.type : null,
    source: typeof r.source === 'string' ? r.source : null,
  };
}

// GET works/certifications/me/available-roles -> { roles:[{clusterId,name,category,proposalKind}] }.
async function requestAvailableRoles({ hubAccessToken } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, null, timeoutMs, 'GET', null, bearerHeaders(hubAccessToken));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };
  const data = envelopeData(res.raw);
  const rows = data && Array.isArray(data.roles) ? data.roles : (Array.isArray(data) ? data : null);
  if (!rows) return { ok: false, reason: 'bad-response' };
  return { ok: true, roles: rows.map(normalizeRole).filter(Boolean) };
}

// GET works/talents/me/work-details/assigned-clusters -> the talent's GROWTH/RECOMMENDED roles.
async function requestAssignedClusters({ hubAccessToken } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, null, timeoutMs, 'GET', null, bearerHeaders(hubAccessToken));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };
  const data = envelopeData(res.raw);
  const rows = Array.isArray(data) ? data : (data && Array.isArray(data.clusters) ? data.clusters : null);
  if (!rows) return { ok: false, reason: 'bad-response' };
  return { ok: true, clusters: rows.map(normalizeRole).filter(Boolean) };
}

// POST works/talents/me/work-details/assigned-clusters { clusterId } -> adds a GROWTH role.
async function requestAddGrowthRole({ clusterId, hubAccessToken } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };
  if (typeof clusterId !== 'string' || !clusterId) return { ok: false, reason: 'no-cluster' };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, { clusterId }, timeoutMs, 'POST', null, bearerHeaders(hubAccessToken));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };
  return { ok: true, clusterId };
}

// PATCH works/certifications/me/main-role { clusterId } -> sets the preferred main role.
async function requestSetMainRole({ clusterId, hubAccessToken } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };
  if (typeof clusterId !== 'string' || !clusterId) return { ok: false, reason: 'no-cluster' };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, { clusterId }, timeoutMs, 'PATCH', null, bearerHeaders(hubAccessToken));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };
  return { ok: true, clusterId };
}

module.exports = {
  normalizeRole,
  requestAvailableRoles,
  requestAssignedClusters,
  requestAddGrowthRole,
  requestSetMainRole,
};
