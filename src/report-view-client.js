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

async function requestUsageReport({ accessToken } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
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

  return {
    ok: true,
    report: data.report && typeof data.report === 'object' ? data.report : null,
    fluency: data.fluency && typeof data.fluency === 'object' ? data.fluency : null,
    interactionQuality:
      data.interactionQuality && typeof data.interactionQuality === 'object'
        ? data.interactionQuality
        : null,
  };
}

module.exports = { requestUsageReport };
