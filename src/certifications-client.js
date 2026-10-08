'use strict';

// My-certifications client (hub `works/certifications/me`, talent Bearer). The
// "By role" page: main-role cluster + its dimension rows (state/band) + ratios.

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

function bearerHeaders(accessToken) {
  const headers = {};
  if (typeof accessToken === 'string' && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

function normalizeCluster(c) {
  if (!c || typeof c !== 'object') return null;
  const progress = c.progress && typeof c.progress === 'object' ? c.progress : {};
  return {
    clusterId: typeof c.clusterId === 'string' ? c.clusterId : null,
    name: typeof c.name === 'string' ? c.name : null,
    category: typeof c.category === 'string' ? c.category : null,
    certified: typeof progress.certified === 'number' ? progress.certified : null,
    total: typeof progress.total === 'number' ? progress.total : null,
  };
}

function normalizeDimension(d) {
  const it = d && typeof d === 'object' ? d : {};
  return {
    slug: typeof it.slug === 'string' ? it.slug : null,
    name: typeof it.name === 'string' ? it.name : null,
    state: typeof it.state === 'string' ? it.state : 'UNCERTIFIED',
    band: typeof it.band === 'string' ? it.band : null,
    expiresAt: typeof it.expiresAt === 'string' ? it.expiresAt : null,
  };
}

async function requestMeCertifications({ hubAccessToken } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, null, timeoutMs, 'GET', null, bearerHeaders(hubAccessToken));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };

  const env = parseJson(res.raw);
  const data = env && env.status === 'OK' ? env.data : env;
  if (!data || typeof data !== 'object') return { ok: false, reason: 'bad-response' };
  const dims = Array.isArray(data.dimensions) ? data.dimensions.map(normalizeDimension) : [];
  return {
    ok: true,
    mainRole: normalizeCluster(data.mainRole),
    growingInto: Array.isArray(data.growingInto) ? data.growingInto.map(normalizeCluster).filter(Boolean) : [],
    dimensions: dims,
    skillsRatio: data.skillsRatio && typeof data.skillsRatio === 'object'
      ? { certified: data.skillsRatio.certified ?? null, total: data.skillsRatio.total ?? null }
      : null,
  };
}

async function fetchMeCertifications(deps = {}, { hubAccessToken, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const {
    getMyCertificationsEndpoint = require('./config').getMyCertificationsEndpoint,
    requestMeCertifications: request = requestMeCertifications,
  } = deps;
  const endpoint = getMyCertificationsEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return request({ hubAccessToken }, { endpoint, timeoutMs });
}

module.exports = {
  normalizeCluster,
  normalizeDimension,
  requestMeCertifications,
  fetchMeCertifications,
};
