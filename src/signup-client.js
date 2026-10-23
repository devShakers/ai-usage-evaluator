'use strict';

const { postJsonWithTimeout } = require('./backend-request');
const { toUpperLang } = require('./lang-codes');

const DEFAULT_TIMEOUT_MS = 30000;

function parseJson(raw) {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function messageFrom(raw) {
  const body = parseJson(raw);
  if (!body || typeof body !== 'object') return null;
  if (typeof body.message === 'string' && body.message) return body.message;
  if (Array.isArray(body.message) && body.message.length) return body.message.join('; ');
  return null;
}

function buildRegistrationContext({ preferredLanguage, newsletterConsent, freelanceType, freelanceIntent } = {}) {
  const context = {};
  if (typeof preferredLanguage === 'string' && preferredLanguage) context.preferredLanguage = toUpperLang(preferredLanguage);
  context.newsletterConsent = newsletterConsent === true;
  if (typeof freelanceType === 'string' && freelanceType) context.freelanceType = freelanceType;
  if (typeof freelanceIntent === 'string' && freelanceIntent) context.freelanceIntent = freelanceIntent;
  return context;
}

const TERMS_VERSION = '2026-10-22';

function buildRegistrationConsent({ newsletterConsent } = {}) {
  return { termsAccepted: true, termsVersion: TERMS_VERSION, newsletterConsent: newsletterConsent === true };
}

// Hub refuses these claims with a coded error and creates nothing, so registering without the code is safe.
const UNCLAIMABLE_CODES = new Set(['auth-engine.claim_code_invalid', 'users.unregistered_talent_not_claimable']);

function codeFrom(raw) {
  const body = parseJson(raw);
  return body && typeof body.code === 'string' ? body.code : null;
}

async function postCompleteRegistration(body, { endpoint, headers, timeoutMs }) {
  let complete;
  try {
    complete = await postJsonWithTimeout(endpoint, body, timeoutMs, 'POST', null, Object.keys(headers).length ? headers : null);
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (complete.status < 200 || complete.status >= 300) {
    return { ok: false, reason: `complete-registration-http-${complete.status}`, status: complete.status, code: codeFrom(complete.raw), message: messageFrom(complete.raw) };
  }
  return { ok: true };
}

// Shared complete-registration call. With a claimCode it claims the MCP sign-up's UNREGISTERED profile; an unclaimable code still registers the account, with claimed:false.
async function requestCompleteRegistration(
  context = {},
  { endpoint, bearerToken = null, claimCode = null, consent = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  const headers = {};
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  const base = consent && consent.termsAccepted === true
    ? { userType: 'WORKS_TALENT', context, consent }
    : { userType: 'WORKS_TALENT', context };
  if (typeof claimCode !== 'string' || !claimCode) return postCompleteRegistration(base, { endpoint, headers, timeoutMs });

  const claimed = await postCompleteRegistration({ ...base, claimCode }, { endpoint, headers, timeoutMs });
  if (claimed.ok) return { ok: true, claimed: true };
  if (!UNCLAIMABLE_CODES.has(claimed.code)) return claimed;
  const plain = await postCompleteRegistration(base, { endpoint, headers, timeoutMs });
  return plain.ok ? { ok: true, claimed: false, claimError: claimed.code } : plain;
}

module.exports = { requestCompleteRegistration, buildRegistrationContext, buildRegistrationConsent, TERMS_VERSION };
