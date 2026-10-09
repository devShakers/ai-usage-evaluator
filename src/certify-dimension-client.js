'use strict';

// Dimension-certification discovery + lifecycle client (hub + certs endpoints).

const { postJsonWithTimeout } = require('./backend-request');
const { reasonForError } = require('./onboarding-client');
const { toUpperLang } = require('./lang-codes');

const DEFAULT_TIMEOUT_MS = 20000;

function parseJson(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function payloadOf(raw) {
  const json = parseJson(raw);
  if (!json || typeof json !== 'object') return undefined;
  if (json.status === 'OK') return json.data;
  return json;
}

function bearerHeaders(accessToken) {
  const headers = {};
  if (typeof accessToken === 'string' && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

function pick(obj, keys) {
  for (const k of keys) {
    const v = obj && obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

// FLAG: hub gives `clusterId`, certs keys templates by `clusterRef`; assumed equal here.
function composeDimensionKey(clusterRef, slug) {
  if (!clusterRef || !slug) return null;
  return `${clusterRef}/${slug}`;
}

async function requestMyCertifications({ hubAccessToken } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, null, timeoutMs, 'GET', null, bearerHeaders(hubAccessToken));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };

  const data = payloadOf(res.raw);
  if (data === undefined || !data || typeof data !== 'object') return { ok: false, reason: 'bad-response' };
  const rawDims = Array.isArray(data) ? data
    : (Array.isArray(data.dimensions) ? data.dimensions
      : (Array.isArray(data.items) ? data.items : []));
  const dimensions = rawDims
    .map((d) => ({
      slug: pick(d, ['slug', 'dimensionSlug', 'key']),
      clusterId: pick(d, ['clusterRef', 'clusterId', 'clusterKey', 'cluster']),
      state: pick(d, ['state', 'status']),
      band: pick(d, ['band', 'level']) || null,
    }))
    .filter((d) => d.slug && d.clusterId);
  return { ok: true, mainRole: pick(data, ['mainRole', 'role']) || null, dimensions };
}

// @Public: no auth header. Returns a Map dimensionKey -> deliveryFormat.
async function requestTemplatesByDimension({ dimensionKeys } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  const keys = (Array.isArray(dimensionKeys) ? dimensionKeys : []).filter(Boolean);
  if (keys.length === 0) return { ok: true, formats: new Map() };

  const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}dimensionKeys=${keys.map(encodeURIComponent).join(',')}`;
  let res;
  try {
    res = await postJsonWithTimeout(url, null, timeoutMs, 'GET', null, {});
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };

  const data = payloadOf(res.raw);
  if (data === undefined || data === null) return { ok: false, reason: 'bad-response' };

  // The real certs route returns rows under `data.items`; templates/bare-array are tolerant fallbacks.
  const formats = new Map();
  const rows = Array.isArray(data)
    ? data
    : (Array.isArray(data.items) ? data.items
      : (Array.isArray(data.templates) ? data.templates : null));
  if (rows) {
    for (const t of rows) {
      const key = pick(t, ['dimensionKey', 'key', 'dimension']);
      const fmt = pick(t, ['deliveryFormat', 'delivery_format', 'format']);
      if (key && fmt) formats.set(String(key), String(fmt));
    }
  } else if (typeof data === 'object') {
    for (const [key, value] of Object.entries(data)) {
      const fmt = value && typeof value === 'object' ? pick(value, ['deliveryFormat', 'delivery_format', 'format']) : value;
      if (fmt) formats.set(String(key), String(fmt));
    }
  }
  return { ok: true, formats };
}

// What the terminal can run: the templates marked for it, and the spoken ones, which are
// conversation only. Whiteboard and screen share need the web.
const TEXT_DELIVERY_FORMATS = new Set(['terminal', 'spoken_case']);

function composeOfferableDimensions({ dimensions, formats } = {}) {
  const fmt = formats instanceof Map ? formats : new Map(Object.entries(formats || {}));
  const candidates = (Array.isArray(dimensions) ? dimensions : [])
    .filter((d) => d && d.state !== 'CERTIFIED')
    .map((d) => ({ ...d, dimensionKey: composeDimensionKey(d.clusterId, d.slug) }))
    .filter((d) => d.dimensionKey);
  const offerable = candidates.filter((d) => TEXT_DELIVERY_FORMATS.has(fmt.get(d.dimensionKey)));
  const unmatched = candidates
    .filter((d) => !fmt.has(d.dimensionKey))
    .map((d) => d.dimensionKey);
  return { offerable, unmatched };
}

async function discoverOfferableDimensions(deps = {}, { accessToken, hubAccessToken, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const {
    getMyCertificationsEndpoint = require('./config').getMyCertificationsEndpoint,
    getTemplatesByDimensionEndpoint = require('./config').getTemplatesByDimensionEndpoint,
    requestMyCertifications: myCerts = requestMyCertifications,
    requestTemplatesByDimension: templates = requestTemplatesByDimension,
  } = deps;

  const mineEndpoint = getMyCertificationsEndpoint();
  if (!mineEndpoint) return { ok: false, reason: 'no-endpoint' };
  const mine = await myCerts({ hubAccessToken }, { endpoint: mineEndpoint, timeoutMs });
  if (!mine.ok) return { ok: false, reason: mine.reason };

  const candidateDims = mine.dimensions.filter((d) => d.state !== 'CERTIFIED');
  if (candidateDims.length === 0) return { ok: true, mainRole: mine.mainRole, offerable: [], unmatched: [] };

  const templatesEndpoint = getTemplatesByDimensionEndpoint();
  if (!templatesEndpoint) return { ok: false, reason: 'no-endpoint' };
  const keys = candidateDims
    .map((d) => composeDimensionKey(d.clusterId, d.slug))
    .filter(Boolean);
  const tmpl = await templates({ dimensionKeys: keys }, { endpoint: templatesEndpoint, timeoutMs });
  if (!tmpl.ok) return { ok: false, reason: tmpl.reason };

  const { offerable, unmatched } = composeOfferableDimensions({ dimensions: candidateDims, formats: tmpl.formats });
  return { ok: true, mainRole: mine.mainRole, offerable, unmatched };
}

async function requestCreateCertificationInterview(
  { dimensionKey, languageCode, accessToken } = {},
  { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!dimensionKey) return { ok: false, reason: 'no-dimension' };
  const body = { dimensionKey };
  if (languageCode) body.languageCode = toUpperLang(languageCode);
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, body, timeoutMs, 'POST', null, bearerHeaders(accessToken));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) {
    const reason = reasonForError(res.status, res.raw);
    if (reason !== 'dimension-on-cooldown') return { ok: false, reason };
    // certs puts the date in the message only: "... available on 2026-10-28T14:50:38.265Z".
    const available = String(res.raw || '').match(/available on (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/);
    return { ok: false, reason, availableOn: available ? available[1] : null };
  }
  const data = payloadOf(res.raw);
  const interviewId = pick(data || {}, ['interviewId', 'id']);
  if (!interviewId) return { ok: false, reason: 'bad-response' };
  return { ok: true, interviewId, language: pick(data || {}, ['language', 'languageCode']) || null };
}

// Poll the verdict; a 2xx/404/425/202 with no band yet resolves `ready:false` (retriable).
async function requestCertificationReport(
  { interviewId, accessToken } = {},
  { base, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!base) return { ok: false, reason: 'no-endpoint' };
  if (!interviewId) return { ok: false, reason: 'no-interview' };
  const url = `${base.replace(/\/+$/, '')}/${encodeURIComponent(interviewId)}/report`;
  let res;
  try {
    res = await postJsonWithTimeout(url, null, timeoutMs, 'GET', null, bearerHeaders(accessToken));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status === 404 || res.status === 425 || res.status === 202) return { ok: true, ready: false, report: null };
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };
  const data = payloadOf(res.raw);
  if (data === undefined || data === null || typeof data !== 'object') return { ok: true, ready: false, report: null };
  const band = pick(data, ['band', 'level', 'combinedLevel']);
  // A report with too little evidence for a level has band null; it is still finished.
  if (!band && !pick(data, ['evaluationId'])) return { ok: true, ready: false, report: null };
  return { ok: true, ready: true, report: data };
}

// The case the web preview shows before starting (works `get-dimension-case`): the exercise statement, else the
// version's brief. `case: null` for a template with neither.
async function requestDimensionCase(
  { dimensionKey, accessToken } = {},
  { base, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!base) return { ok: false, reason: 'no-endpoint' };
  if (!dimensionKey) return { ok: false, reason: 'no-dimension' };
  const path = String(dimensionKey).split('/').map(encodeURIComponent).join('/');
  const url = `${base.replace(/\/+$/, '')}/dimension/${path}/case`;
  let res;
  try {
    res = await postJsonWithTimeout(url, null, timeoutMs, 'GET', null, bearerHeaders(accessToken));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };
  const data = payloadOf(res.raw);
  if (!data || typeof data !== 'object') return { ok: false, reason: 'bad-response' };
  const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  const brief = text(data.statement) || text(data.candidateBrief);
  return { ok: true, case: brief ? { brief, testType: text(data.testType) } : null };
}

module.exports = {
  requestMyCertifications,
  requestTemplatesByDimension,
  requestCreateCertificationInterview,
  requestCertificationReport,
  requestDimensionCase,
  composeDimensionKey,
  composeOfferableDimensions,
  discoverOfferableDimensions,
  TEXT_DELIVERY_FORMATS,
};
