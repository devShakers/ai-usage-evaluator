'use strict';

// My-applications client (hub `works/candidatures/me`, talent Bearer). Lists the
// positions the talent applied to, with the candidature status.

const { postJsonWithTimeout } = require('./backend-request');
const { reasonForError } = require('./onboarding-client');

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_LIMIT = 30;

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

function normalizeApplication(raw) {
  const it = raw && typeof raw === 'object' ? raw : {};
  const project = it.project && typeof it.project === 'object' ? it.project : {};
  const position = it.position && typeof it.position === 'object' ? it.position : {};
  const org = it.organization && typeof it.organization === 'object' ? it.organization : {};
  return {
    positionId: str(position.id),
    title: str(position.name) || str(project.name),
    projectName: str(project.name),
    company: str(org.name),
    status: str(it.status),
    createdAt: str(it.createdAt),
  };
}

async function requestMyCandidatures({ hubAccessToken } = {}, { endpoint, limit = DEFAULT_LIMIT, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };
  const criteria = { limit, offset: 0 };
  const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}criteria=${encodeURIComponent(JSON.stringify(criteria))}`;
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
  return { ok: true, items: rows.map(normalizeApplication), meta: (env && typeof env.meta === 'object' ? env.meta : null) };
}

async function fetchApplications(deps = {}, { hubAccessToken, limit = DEFAULT_LIMIT, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const {
    getMyCandidaturesEndpoint = require('./config').getMyCandidaturesEndpoint,
    requestMyCandidatures: request = requestMyCandidatures,
  } = deps;
  const endpoint = getMyCandidaturesEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return request({ hubAccessToken }, { endpoint, limit, timeoutMs });
}

module.exports = {
  normalizeApplication,
  requestMyCandidatures,
  fetchApplications,
};
