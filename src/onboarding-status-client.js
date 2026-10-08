'use strict';

const { postJsonWithTimeout } = require('./backend-request');

const DEFAULT_TIMEOUT_MS = 12000;

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

async function requestOnboardingStatus({ accessToken } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };

  let res;
  try {
    res = await postJsonWithTimeout(endpoint, null, timeoutMs, 'GET', null, authHeaders({ accessToken }));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }

  if (res.status < 200 || res.status >= 300) {
    return { ok: false, reason: `http-${res.status}` };
  }

  const json = parseJson(res.raw);
  const data = json && typeof json === 'object' ? json.data : null;
  if (!data || typeof data !== 'object') return { ok: false, reason: 'bad-response' };

  return { ok: true, completed: data.completed === true };
}

// GET <certs>/interviews/:id/finalization -> COLLECTING | PROCESSING | READY | FAILED for a completed interview's evaluation.
async function requestInterviewFinalization({ interviewId, accessToken } = {}, { base, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!base || !interviewId) return { ok: false, reason: 'no-endpoint' };
  let res;
  try {
    res = await postJsonWithTimeout(`${base}/${encodeURIComponent(interviewId)}/finalization`, null, timeoutMs, 'GET', null, authHeaders({ accessToken }));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: `http-${res.status}` };
  const json = parseJson(res.raw);
  const status = json && json.data && typeof json.data.status === 'string' ? json.data.status : null;
  return status ? { ok: true, status } : { ok: false, reason: 'bad-response' };
}

module.exports = { requestOnboardingStatus, requestInterviewFinalization };
