'use strict';

// Position detail client (hub `works/positions/:id/detail`, talent Bearer).
// A "project" here is the Position + its parent project's fields.

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

async function requestPositionDetail({ hubAccessToken } = {}, { positionId, endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!positionId) return { ok: false, reason: 'no-id' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, null, timeoutMs, 'GET', null, bearerHeaders(hubAccessToken));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status === 404) return { ok: false, reason: 'not-found' };
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };

  const env = parseJson(res.raw);
  const data = env && env.status === 'OK' ? env.data : env;
  if (!data || typeof data !== 'object') return { ok: false, reason: 'bad-response' };
  return { ok: true, position: data.position || null, redirectUrl: data.redirectUrl || null };
}

// CLI+MCP entry: resolve the endpoint from config, then fetch one detail.
async function fetchPositionDetail(deps = {}, { hubAccessToken, positionId, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const {
    getPositionDetailEndpoint = require('./config').getPositionDetailEndpoint,
    requestPositionDetail: request = requestPositionDetail,
  } = deps;
  const endpoint = getPositionDetailEndpoint(positionId);
  if (!endpoint) return { ok: false, reason: positionId ? 'no-endpoint' : 'no-id' };
  return request({ hubAccessToken }, { positionId, endpoint, timeoutMs });
}

module.exports = {
  requestPositionDetail,
  fetchPositionDetail,
};
