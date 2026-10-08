'use strict';

// AI-profile client (hub `works/me/ai-profile`, talent Bearer). The "My work
// with AI" read model: setup/usage tier+level, 3x3 cell, vision, howIWork.

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

function str(v) {
  return typeof v === 'string' && v ? v : null;
}

async function requestAiProfile({ hubAccessToken } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
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
  const setup = data.setup && typeof data.setup === 'object' ? data.setup : {};
  const usage = data.usage && typeof data.usage === 'object' ? data.usage : {};
  const traction = data.traction && typeof data.traction === 'object' ? data.traction : {};
  return {
    ok: true,
    aiProfile: {
      setupTier: str(setup.tier),
      setupLevel: str(setup.level),
      usageLevel: str(usage.level),
      cell: str(data.cell),
      isAiNative: data.isAiNative === true,
      agentsOnProfile: typeof traction.agentsOnProfile === 'number' ? traction.agentsOnProfile : null,
      vision: data.vision && typeof data.vision === 'object' ? str(data.vision.text) : null,
      howIWork: data.howIWork && typeof data.howIWork === 'object' ? str(data.howIWork.body) : null,
    },
  };
}

async function fetchAiProfile(deps = {}, { hubAccessToken, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const {
    getAiProfileEndpoint = require('./config').getAiProfileEndpoint,
    requestAiProfile: request = requestAiProfile,
  } = deps;
  const endpoint = getAiProfileEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return request({ hubAccessToken }, { endpoint, timeoutMs });
}

// GET on a hub endpoint that returns a `{status,data}` envelope, mapped by `map`.
async function getMapped(endpoint, hubAccessToken, timeoutMs, map) {
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
  if (data === undefined || data === null) return { ok: false, reason: 'bad-response' };
  return { ok: true, ...map(data) };
}

// `works/me/profile` -> headline (basic profile text).
async function fetchMeProfile(deps = {}, { hubAccessToken, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const getEndpoint = deps.getMeProfileEndpoint || require('./config').getMeProfileEndpoint;
  const req = deps.getMapped || getMapped;
  return req(getEndpoint(), hubAccessToken, timeoutMs, (d) => ({ headline: str(d && d.headline) }));
}

// `works/talents/me/profile` -> completion %, freelance type, onboarding status.
async function fetchTalentMeProfile(deps = {}, { hubAccessToken, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const getEndpoint = deps.getTalentMeProfileEndpoint || require('./config').getTalentMeProfileEndpoint;
  const req = deps.getMapped || getMapped;
  return req(getEndpoint(), hubAccessToken, timeoutMs, (d) => ({
    completedProfilePercentage: typeof (d && d.completedProfilePercentage) === 'number' ? d.completedProfilePercentage : null,
    freelanceType: str(d && d.freelanceType),
    onboardingStatus: str(d && d.onboardingStatus),
  }));
}

// `works/talents/me/work-details/languages` -> count + codes.
async function fetchLanguages(deps = {}, { hubAccessToken, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const getEndpoint = deps.getLanguagesEndpoint || require('./config').getLanguagesEndpoint;
  const req = deps.getMapped || getMapped;
  return req(getEndpoint(), hubAccessToken, timeoutMs, (d) => {
    const rows = Array.isArray(d) ? d : (Array.isArray(d && d.items) ? d.items : []);
    const codes = rows.map((r) => (r && r.language && str(r.language.code)) || str(r && r.code)).filter(Boolean);
    return { languageCodes: codes, languageCount: rows.length };
  });
}

module.exports = {
  requestAiProfile,
  fetchAiProfile,
  fetchMeProfile,
  fetchTalentMeProfile,
  fetchLanguages,
};
