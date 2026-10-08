'use strict';

// Saved-positions client (hub `works/saved-positions`, talent Bearer). Both
// operations are idempotent server-side, so no read-before-write is needed.

const { postJsonWithTimeout } = require('./backend-request');
const { reasonForError } = require('./onboarding-client');

const DEFAULT_TIMEOUT_MS = 20000;

function bearerHeaders(accessToken) {
  const headers = {};
  if (typeof accessToken === 'string' && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

async function requestSavePosition({ hubAccessToken } = {}, { positionId, endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!positionId) return { ok: false, reason: 'no-id' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, { positionId }, timeoutMs, 'POST', null, bearerHeaders(hubAccessToken));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status === 404) return { ok: false, reason: 'not-found' };
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };
  return { ok: true };
}

async function requestUnsavePosition({ hubAccessToken } = {}, { positionId, endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!positionId) return { ok: false, reason: 'no-id' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, null, timeoutMs, 'DELETE', null, bearerHeaders(hubAccessToken));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };
  return { ok: true };
}

async function savePosition(deps = {}, { hubAccessToken, positionId, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const {
    getSavePositionEndpoint = require('./config').getSavePositionEndpoint,
    requestSavePosition: request = requestSavePosition,
  } = deps;
  const endpoint = getSavePositionEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return request({ hubAccessToken }, { positionId, endpoint, timeoutMs });
}

async function unsavePosition(deps = {}, { hubAccessToken, positionId, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const {
    getUnsavePositionEndpoint = require('./config').getUnsavePositionEndpoint,
    requestUnsavePosition: request = requestUnsavePosition,
  } = deps;
  const endpoint = getUnsavePositionEndpoint(positionId);
  if (!endpoint) return { ok: false, reason: positionId ? 'no-endpoint' : 'no-id' };
  return request({ hubAccessToken }, { positionId, endpoint, timeoutMs });
}

module.exports = {
  requestSavePosition,
  requestUnsavePosition,
  savePosition,
  unsavePosition,
};
