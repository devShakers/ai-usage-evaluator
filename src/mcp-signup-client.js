'use strict';

const { postJsonWithTimeout, postMultipartWithTimeout } = require('./backend-request');

// Hub calls of the MCP sign-up (ticket 39540): public sign-up + claim code, the signed-in talent's import status, and the one-time web login token.

const SIGNUP_TIMEOUT_MS = 60000;
const DEFAULT_TIMEOUT_MS = 15000;

// Hub's coded errors on the sign-up, verified against the works-ai exception filter (hub MR !2198); none says whether an account exists.
const CODE_TO_REASON = {
  MISSING_SOURCE: 'missing-source',
  INVALID_CV: 'invalid-cv',
  INVALID_LINKEDIN_URL: 'invalid-linkedin-url',
  RATE_LIMITED: 'rate-limited',
};
const IMPORT_SOURCES = ['linkedin', 'cv'];

function parseJson(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function failure(res) {
  const body = parseJson(res.raw);
  const code = body && typeof body.code === 'string' ? body.code : null;
  return { ok: false, reason: (code && CODE_TO_REASON[code]) || `http-${res.status}`, status: res.status };
}

function envelopeData(raw) {
  const json = parseJson(raw);
  return json && json.status === 'OK' && json.data && typeof json.data === 'object' ? json.data : null;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function requestMcpSignup(
  { linkedinUrl, cv, email, firstName, lastName, userQuery, language } = {},
  { endpoint, timeoutMs = SIGNUP_TIMEOUT_MS } = {},
) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  const fields = {
    linkedinUrl: nonEmpty(linkedinUrl),
    email: nonEmpty(email),
    firstName: nonEmpty(firstName),
    lastName: nonEmpty(lastName),
    userQuery: nonEmpty(userQuery),
    language: nonEmpty(language),
    file: cv && Buffer.isBuffer(cv.data) ? cv : undefined,
  };
  let res;
  try {
    res = await postMultipartWithTimeout(endpoint, fields, timeoutMs, 'POST');
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return failure(res);
  const data = envelopeData(res.raw);
  if (!data || typeof data.claimCode !== 'string' || !data.claimCode) return { ok: false, reason: 'bad-response' };
  return { ok: true, claimCode: data.claimCode, claimCodeExpiresAt: data.claimCodeExpiresAt || null };
}

// hub works/me/import-profile/status → { state: running | done | failed, sources: { linkedin?, cv? } }, the shape signup_status reports.
function importStateOf(data) {
  const status = data.profileImportStatus;
  const reported = Array.isArray(data.sources) ? data.sources : [];
  const sources = {};
  for (const entry of reported) {
    if (!entry || !IMPORT_SOURCES.includes(entry.source) || !['imported', 'failed'].includes(entry.status)) continue;
    const failed = entry.status === 'failed';
    sources[entry.source] = { state: failed ? 'failed' : 'done', ...(failed && typeof entry.code === 'string' ? { code: entry.code } : {}) };
  }
  if (status === 'PENDING' || status === 'RUNNING') return { state: 'running', sources: {} };
  if (status === 'FAILED' || status === 'SKIPPED') return { state: 'failed', code: data.errorCode || null, sources };
  if (status === 'DONE') return { state: 'done', sources };
  return { state: 'none', sources: {} };
}

async function requestMyImportStatus({ hubAccessToken } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-session' };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, null, timeoutMs, 'GET', null, { Authorization: `Bearer ${hubAccessToken}` });
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: `http-${res.status}`, status: res.status };
  const data = envelopeData(res.raw);
  if (!data) return { ok: false, reason: 'bad-response' };
  return { ok: true, ...importStateOf(data) };
}

// better-auth reads the session from the cookie (email sign-in) or the Bearer session token (device flow).
async function requestOneTimeToken({ cookie = null, sessionToken = null } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  else if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  else return { ok: false, reason: 'no-session' };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, null, timeoutMs, 'GET', null, headers);
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: `http-${res.status}`, status: res.status };
  const body = parseJson(res.raw);
  const token = body && (typeof body.token === 'string' ? body.token : (body.data && body.data.token));
  return typeof token === 'string' && token ? { ok: true, token } : { ok: false, reason: 'bad-response' };
}

module.exports = { requestMcpSignup, requestMyImportStatus, requestOneTimeToken, CODE_TO_REASON };
