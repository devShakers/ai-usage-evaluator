'use strict';

// Availability client. VIEW = GET `works/me/availability`; SET = PUT
// `works/talents/me/work-details/availability` (the same endpoint register uses).

const { postJsonWithTimeout } = require('./backend-request');
const { reasonForError } = require('./onboarding-client');
const { WORK_MODES } = require('./onboarding-flow');

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

function bool(v) {
  return v === true ? true : v === false ? false : null;
}

function str(v) {
  return typeof v === 'string' && v ? v : null;
}

function normalizeAvailability(data) {
  const it = data && typeof data === 'object' ? data : {};
  return {
    available: bool(it.available),
    // A numeric hours value (incl. 0) must survive, not be dropped as "absent".
    monthlyHours: typeof it.monthlyHours === 'number' ? String(it.monthlyHours) : str(it.monthlyHours),
    workModes: Array.isArray(it.workModes) ? it.workModes.filter((m) => WORK_MODES.includes(m)) : [],
    country: str(it.country),
    subdivision: str(it.subdivision),
    timezone: str(it.timezone),
    city: typeof it.city === 'number' ? it.city : null,
    longFullTimeProjects: bool(it.longFullTimeProjects),
    availabilityExpiringDate: it.availabilityExpiringDate ? String(it.availabilityExpiringDate) : null,
  };
}

async function requestAvailability({ hubAccessToken } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
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
  return { ok: true, availability: normalizeAvailability(data) };
}

async function fetchAvailability(deps = {}, { hubAccessToken, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const {
    getMeAvailabilityEndpoint = require('./config').getMeAvailabilityEndpoint,
    requestAvailability: request = requestAvailability,
  } = deps;
  const endpoint = getMeAvailabilityEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return request({ hubAccessToken }, { endpoint, timeoutMs });
}

// Partial upsert: only the changed fields ride the PUT (all fields optional).
async function saveAvailability(deps = {}, { hubAccessToken, availability, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const {
    getSetAvailabilityEndpoint = require('./config').getSetAvailabilityEndpoint,
    requestSetAvailability = require('./onboarding-client').requestSetAvailability,
  } = deps;
  const endpoint = getSetAvailabilityEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return requestSetAvailability({ availability, hubAccessToken }, { endpoint, timeoutMs });
}

module.exports = {
  normalizeAvailability,
  requestAvailability,
  fetchAvailability,
  saveAvailability,
};
