'use strict';

const { postJsonWithTimeout, postMultipartWithTimeout } = require('./backend-request');
const { WORKS_CODE_TO_REASON } = require('./skills-client');
const { toLowerLang, toUpperLang } = require('./lang-codes');
const { readLocalCv } = require('./cv-file');

const DEFAULT_TIMEOUT_MS = 20000;
const IMPORT_KICKOFF_TIMEOUT_MS = 90000;

function parseJson(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function hubHeaders({ hubAccessToken } = {}) {
  const headers = {};
  if (typeof hubAccessToken === 'string' && hubAccessToken) headers.Authorization = `Bearer ${hubAccessToken}`;
  return headers;
}

function bearerHeaders({ accessToken } = {}) {
  const headers = {};
  if (typeof accessToken === 'string' && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

function reasonForError(status, raw) {
  const body = parseJson(raw);
  const code = body && typeof body.code === 'string' ? body.code : null;
  return (code && WORKS_CODE_TO_REASON[code]) || `http-${status}`;
}

function envelopeData(raw) {
  const json = parseJson(raw);
  if (!json || typeof json !== 'object' || json.status !== 'OK') return undefined;
  return json.data;
}

function buildImportSources({ linkedinUrl, cvPath, githubUrl, websiteUrl, language, userQuery, fillEmptyOnly } = {}) {
  const sources = { language: toLowerLang(language) };
  if (typeof linkedinUrl === 'string' && linkedinUrl) sources.linkedinUrl = linkedinUrl;
  if (typeof cvPath === 'string' && cvPath) sources.cvPath = cvPath;
  if (typeof githubUrl === 'string' && githubUrl) sources.githubUrl = githubUrl;
  if (typeof websiteUrl === 'string' && websiteUrl) sources.websiteUrl = websiteUrl;
  if (typeof userQuery === 'string' && userQuery) sources.userQuery = userQuery;
  if (fillEmptyOnly === true) sources.fillEmptyOnly = true;
  return sources;
}

// Hub answers import-profile synchronously with a per-source report; null when the AI omitted it.
function importReportFrom(data) {
  const report = data && typeof data === 'object' ? data.importReport : null;
  if (!report || !Array.isArray(report.sources)) return null;
  return {
    outcome: typeof report.outcome === 'string' ? report.outcome : null,
    sources: report.sources
      .filter((src) => src && typeof src.source === 'string')
      .map((src) => ({
        source: src.source,
        status: typeof src.status === 'string' ? src.status : null,
        ...(typeof src.code === 'string' ? { code: src.code } : {}),
        ...(typeof src.retryable === 'boolean' ? { retryable: src.retryable } : {}),
      })),
  };
}

// The CV formats hub accepts on import-profile.
function readCvUpload(input) {
  return readLocalCv(input, { extensions: ['.pdf', '.doc', '.docx'], badFormat: 'cv-bad-format' });
}

async function requestImportProfile(
  { linkedinUrl, cvPath, githubUrl, websiteUrl, language, userQuery, fillEmptyOnly, accessToken, hubAccessToken } = {},
  { endpoint, timeoutMs = IMPORT_KICKOFF_TIMEOUT_MS } = {},
) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!linkedinUrl && !cvPath && !githubUrl && !websiteUrl) return { ok: false, reason: 'no-source' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };

  const body = buildImportSources({ linkedinUrl, cvPath, githubUrl, websiteUrl, language, userQuery, fillEmptyOnly });
  let res;
  try {
    if (body.cvPath) {
      // Hub reads the CV as an uploaded `cv` file (multipart), never as a local
      // path: a path on the talent's machine means nothing to the server.
      const cv = readCvUpload(body.cvPath);
      if (!cv.ok) return cv;
      const { cvPath: _localPath, ...fields } = body;
      const form = { ...fields, fillEmptyOnly: fields.fillEmptyOnly ? 'true' : undefined };
      res = await postMultipartWithTimeout(endpoint, { ...form, cv: cv.file }, timeoutMs, 'POST', hubHeaders({ hubAccessToken }));
    } else {
      res = await postJsonWithTimeout(endpoint, body, timeoutMs, 'POST', null, hubHeaders({ hubAccessToken }));
    }
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };

  const data = envelopeData(res.raw);
  if (data === undefined) return { ok: false, reason: 'bad-response' };
  return { ok: true, report: importReportFrom(data) };
}

async function requestSetProfessionalDetails(
  { currentEmploymentStatus, freelanceIntent, changeMotivators, freelanceType, accessToken, hubAccessToken } = {},
  { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };

  const body = {};
  if (typeof currentEmploymentStatus === 'string' && currentEmploymentStatus) body.currentEmploymentStatus = currentEmploymentStatus;
  if (typeof freelanceIntent === 'string' && freelanceIntent) body.freelanceIntent = freelanceIntent;
  if (typeof changeMotivators === 'string' && changeMotivators) body.changeMotivators = changeMotivators;
  // freelanceType derived from the work situation (the single place it is asked now).
  if (typeof freelanceType === 'string' && freelanceType) body.freelanceType = freelanceType;
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, body, timeoutMs, 'PATCH', null, hubHeaders({ hubAccessToken }));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };
  if (envelopeData(res.raw) === undefined) return { ok: false, reason: 'bad-response' };
  return { ok: true };
}

async function requestSetPricingRate(
  { pricing, accessToken, hubAccessToken } = {},
  { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };
  if (!pricing || typeof pricing !== 'object') return { ok: false, reason: 'no-pricing' };

  let res;
  try {
    res = await postJsonWithTimeout(endpoint, pricing, timeoutMs, 'PUT', null, hubHeaders({ hubAccessToken }));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };
  if (envelopeData(res.raw) === undefined) return { ok: false, reason: 'bad-response' };
  return { ok: true };
}

async function requestSetAvailability(
  { availability, accessToken, hubAccessToken } = {},
  { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };
  if (!availability || typeof availability !== 'object') return { ok: false, reason: 'no-availability' };

  let res;
  try {
    res = await postJsonWithTimeout(endpoint, availability, timeoutMs, 'PUT', null, hubHeaders({ hubAccessToken }));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };
  if (envelopeData(res.raw) === undefined) return { ok: false, reason: 'bad-response' };
  return { ok: true };
}

async function requestLanguagesCatalog(
  { hubAccessToken } = {},
  { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };

  let res;
  try {
    res = await postJsonWithTimeout(endpoint, null, timeoutMs, 'GET', null, hubHeaders({ hubAccessToken }));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };

  const data = envelopeData(res.raw);
  if (!Array.isArray(data)) return { ok: false, reason: 'bad-response' };
  return { ok: true, languages: data };
}

async function requestSetLanguages(
  { languages, accessToken, hubAccessToken } = {},
  { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };
  if (!Array.isArray(languages) || languages.length === 0) return { ok: false, reason: 'no-languages' };

  let res;
  try {
    res = await postJsonWithTimeout(endpoint, { languages }, timeoutMs, 'PATCH', null, hubHeaders({ hubAccessToken }));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };
  if (envelopeData(res.raw) === undefined) return { ok: false, reason: 'bad-response' };
  return { ok: true };
}

async function requestSetTalentPhone(
  { telephoneCode, telephoneNumber, accessToken, hubAccessToken } = {},
  { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };

  const body = { telephoneCode, telephoneNumber };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, body, timeoutMs, 'PATCH', null, hubHeaders({ hubAccessToken }));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };
  if (envelopeData(res.raw) === undefined) return { ok: false, reason: 'bad-response' };
  return { ok: true };
}

async function requestCompleteOnboarding(
  { accessToken, hubAccessToken } = {},
  { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };

  let res;
  try {
    res = await postJsonWithTimeout(endpoint, null, timeoutMs, 'POST', null, hubHeaders({ hubAccessToken }));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };

  const data = envelopeData(res.raw);
  if (data === undefined) return { ok: false, reason: 'bad-response' };
  const d = data && typeof data === 'object' ? data : {};
  return {
    ok: true,
    onboardingStatus: typeof d.onboardingStatus === 'string' ? d.onboardingStatus : null,
    registrationLevel: typeof d.registrationLevel === 'string' ? d.registrationLevel : null,
    completedProfilePercentage: typeof d.completedProfilePercentage === 'number' ? d.completedProfilePercentage : null,
  };
}

// PATCH /interviews/onboarding/restart (no body) — overwrites the taken onboarding interview in-place so it can be re-run.
async function requestRestartOnboardingInterview(
  { accessToken } = {},
  { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, null, timeoutMs, 'PATCH', null, bearerHeaders({ accessToken }));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw), status: res.status };

  const data = envelopeData(res.raw);
  const d = data && typeof data === 'object' ? data : {};
  return { ok: true, interviewId: d.interviewId || null, language: d.language || null };
}

async function requestCreateOnboardingInterview(
  { candidateId, accessToken } = {},
  { base, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!base) return { ok: false, reason: 'no-endpoint' };
  if (!candidateId) return { ok: false, reason: 'no-candidate' };

  const url = `${base.replace(/\/+$/, '')}/onboarding`;
  let res;
  try {
    res = await postJsonWithTimeout(url, { candidateId }, timeoutMs, 'POST', null, bearerHeaders({ accessToken }));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };

  const data = envelopeData(res.raw);
  if (data === undefined || !data || typeof data !== 'object' || !data.interviewId) return { ok: false, reason: 'bad-response' };
  return { ok: true, interviewId: data.interviewId, created: data.created === true, language: data.language || null };
}

async function requestStartTextSession(
  { interviewId, language, accessToken } = {},
  { base, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!base) return { ok: false, reason: 'no-endpoint' };
  if (!interviewId) return { ok: false, reason: 'no-interview' };

  const url = `${base.replace(/\/+$/, '')}/${encodeURIComponent(interviewId)}/text-session`;
  const body = { language: toUpperLang(language) };
  let res;
  try {
    res = await postJsonWithTimeout(url, body, timeoutMs, 'POST', null, bearerHeaders({ accessToken }));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };

  const data = envelopeData(res.raw);
  if (data === undefined || !data || typeof data !== 'object') return { ok: false, reason: 'bad-response' };
  return { ok: true, interviewId: data.interviewId || interviewId, greeting: typeof data.greeting === 'string' ? data.greeting : '' };
}

async function requestOnboardingTurn(
  { interviewId, message, accessToken } = {},
  { base, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!base) return { ok: false, reason: 'no-endpoint' };
  if (!interviewId) return { ok: false, reason: 'no-interview' };
  if (typeof message !== 'string' || !message) return { ok: false, reason: 'no-message' };

  const url = `${base.replace(/\/+$/, '')}/${encodeURIComponent(interviewId)}/text-session/turns`;
  let res;
  try {
    res = await postJsonWithTimeout(url, { message }, timeoutMs, 'POST', null, bearerHeaders({ accessToken }));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };

  const data = envelopeData(res.raw);
  if (data === undefined || !data || typeof data !== 'object') return { ok: false, reason: 'bad-response' };
  return { ok: true, response: typeof data.response === 'string' ? data.response : '', ended: data.ended === true };
}

async function requestCompleteTextSession(
  { interviewId, accessToken } = {},
  { base, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!base) return { ok: false, reason: 'no-endpoint' };
  if (!interviewId) return { ok: false, reason: 'no-interview' };

  const url = `${base.replace(/\/+$/, '')}/${encodeURIComponent(interviewId)}/text-session/complete`;
  let res;
  try {
    res = await postJsonWithTimeout(url, null, timeoutMs, 'POST', null, bearerHeaders({ accessToken }));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };

  const data = envelopeData(res.raw);
  if (data === undefined || !data || typeof data !== 'object') return { ok: false, reason: 'bad-response' };
  return { ok: true, state: typeof data.state === 'string' ? data.state : null };
}

module.exports = {
  requestImportProfile,
  requestSetProfessionalDetails,
  requestSetPricingRate,
  requestSetAvailability,
  requestLanguagesCatalog,
  requestSetLanguages,
  requestSetTalentPhone,
  requestCompleteOnboarding,
  requestRestartOnboardingInterview,
  requestCreateOnboardingInterview,
  requestStartTextSession,
  requestOnboardingTurn,
  requestCompleteTextSession,
  buildImportSources,
  reasonForError,
};
