'use strict';

// Languages client. VIEW = GET `works/talents/me/work-details/languages`; the
// catalog (id<->name) = GET `static-data/languages` (@Public); SET = PATCH the
// same work-details endpoint (REPLACE-ALL: send the full list of {id, level}).

const { postJsonWithTimeout } = require('./backend-request');
const { reasonForError } = require('./onboarding-client');

const DEFAULT_TIMEOUT_MS = 20000;
const LEVELS = ['NATIVE', 'ADVANCED', 'INTERMEDIATE', 'INTERMEDIATE_WRITTEN'];

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

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v) {
  return typeof v === 'string' && v ? v : null;
}

// The hub returns `language.name` as an i18n KEY (staticDataLanguagesName_N),
// which the CLI cannot resolve — so we display by ISO code, mapping the common
// ones to a readable name and falling back to the bare code. NEVER the key.
const LANGUAGE_NAMES = {
  ES: 'Spanish', EN: 'English', FR: 'French', DE: 'German', IT: 'Italian',
  PT: 'Portuguese', CA: 'Catalan', EU: 'Basque', GL: 'Galician', NL: 'Dutch',
  ZH: 'Chinese', JA: 'Japanese', KO: 'Korean', AR: 'Arabic', RU: 'Russian',
  PL: 'Polish', TR: 'Turkish', SV: 'Swedish', NO: 'Norwegian', DA: 'Danish',
  FI: 'Finnish', EL: 'Greek', CS: 'Czech', RO: 'Romanian', HU: 'Hungarian',
  UK: 'Ukrainian', HE: 'Hebrew', HI: 'Hindi', ID: 'Indonesian', VI: 'Vietnamese',
};

function languageName(code) {
  const c = str(code) ? String(code).toUpperCase() : null;
  if (!c) return null;
  return LANGUAGE_NAMES[c] || c;
}

function rowsOf(raw) {
  const env = parseJson(raw);
  const data = env && env.status === 'OK' ? env.data : env;
  return Array.isArray(data) ? data : (Array.isArray(data && data.items) ? data.items : null);
}

// The talent's languages: [{ id, code, name, level }].
async function requestLanguages({ hubAccessToken } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, null, timeoutMs, 'GET', null, bearerHeaders(hubAccessToken));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };
  const rows = rowsOf(res.raw);
  if (!rows) return { ok: false, reason: 'bad-response' };
  const languages = rows.map((r) => {
    const lang = r && r.language && typeof r.language === 'object' ? r.language : {};
    const code = str(lang.code) || str(r && r.code);
    // `name` is derived from the code (readable or bare code), never the raw
    // i18n-key the hub sends (staticDataLanguagesName_N), which we can't resolve.
    return { id: num(lang.id) ?? num(r && r.id), code, name: languageName(code), level: str(r && r.level) };
  }).filter((l) => l.id != null);
  return { ok: true, languages };
}

// The full language catalog (id/name/code), for picking a language to add.
async function requestLanguageCatalog(_ = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, null, timeoutMs, 'GET', null, {});
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };
  const rows = rowsOf(res.raw);
  if (!rows) return { ok: false, reason: 'bad-response' };
  // Same rule: display by code (readable or bare), never the i18n-key name.
  const catalog = rows.map((r) => { const code = str(r && r.code); return { id: num(r && r.id), code, name: languageName(code) }; }).filter((l) => l.id != null && l.name);
  return { ok: true, catalog };
}

// REPLACE-ALL: `languages` is the FULL desired set of { id, level }.
async function requestSetLanguages({ hubAccessToken, languages } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };
  if (!Array.isArray(languages)) return { ok: false, reason: 'no-languages' };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, { languages }, timeoutMs, 'PATCH', null, bearerHeaders(hubAccessToken));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };
  return { ok: true };
}

async function fetchLanguages(deps = {}, { hubAccessToken, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const getEndpoint = deps.getLanguagesEndpoint || require('./config').getLanguagesEndpoint;
  const request = deps.requestLanguages || requestLanguages;
  const endpoint = getEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return request({ hubAccessToken }, { endpoint, timeoutMs });
}

async function fetchLanguageCatalog(deps = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const getEndpoint = deps.getLanguagesCatalogEndpoint || require('./config').getLanguagesCatalogEndpoint;
  const request = deps.requestLanguageCatalog || requestLanguageCatalog;
  const endpoint = getEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return request({}, { endpoint, timeoutMs });
}

async function saveLanguages(deps = {}, { hubAccessToken, languages, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const getEndpoint = deps.getLanguagesEndpoint || require('./config').getLanguagesEndpoint;
  const request = deps.requestSetLanguages || requestSetLanguages;
  const endpoint = getEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return request({ hubAccessToken, languages }, { endpoint, timeoutMs });
}

module.exports = {
  LEVELS,
  languageName,
  requestLanguages,
  requestLanguageCatalog,
  requestSetLanguages,
  fetchLanguages,
  fetchLanguageCatalog,
  saveLanguages,
};
