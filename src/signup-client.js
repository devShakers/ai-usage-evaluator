'use strict';

const { postJsonWithTimeout, extractSetCookie } = require('./backend-request');
const { SESSION_COOKIE_NAME } = require('./auth-client');
const { toUpperLang } = require('./lang-codes');

// Register a talent via the Hub's better-auth email engine, in two steps (owner decision, supersedes ADR-031 for the email path — WEB-login parity): 1.

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
  { endpoint, cookie = null, bearerToken = null, claimCode = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  const base = { userType: 'WORKS_TALENT', context };
  if (typeof claimCode !== 'string' || !claimCode) return postCompleteRegistration(base, { endpoint, headers, timeoutMs });

  const claimed = await postCompleteRegistration({ ...base, claimCode }, { endpoint, headers, timeoutMs });
  if (claimed.ok) return { ok: true, claimed: true };
  if (!UNCLAIMABLE_CODES.has(claimed.code)) return claimed;
  const plain = await postCompleteRegistration(base, { endpoint, headers, timeoutMs });
  return plain.ok ? { ok: true, claimed: false, claimError: claimed.code } : plain;
}

async function requestSignUp(
  { name, lastName, email, password, preferredLanguage, newsletterConsent, freelanceType, freelanceIntent, claimCode = null } = {},
  { signUpEndpoint, completeRegistrationEndpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!signUpEndpoint) return { ok: false, reason: 'no-endpoint' };
  if (!name || !lastName || !email || !password) return { ok: false, reason: 'missing-fields' };

  let signUp;
  try {
    signUp = await postJsonWithTimeout(signUpEndpoint, { email, password, name, lastName }, timeoutMs);
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }

  // A duplicate email is a normal outcome the caller handles by switching to login.
  if (signUp.status === 409 || signUp.status === 422) return { ok: true, accountExists: true };
  if (signUp.status < 200 || signUp.status >= 300) {
    return { ok: false, reason: `http-${signUp.status}`, status: signUp.status, message: messageFrom(signUp.raw) };
  }

  const cookie = extractSetCookie(signUp.headers, SESSION_COOKIE_NAME);
  if (!cookie) return { ok: false, reason: 'bad-response' };

  if (!completeRegistrationEndpoint) return { ok: false, reason: 'no-endpoint' };

  const context = buildRegistrationContext({ preferredLanguage, newsletterConsent, freelanceType, freelanceIntent });
  const complete = await requestCompleteRegistration(context, { endpoint: completeRegistrationEndpoint, cookie, claimCode, timeoutMs });
  if (!complete.ok) return complete;
  return claimCode ? { ok: true, accountExists: false, claimed: complete.claimed === true } : { ok: true, accountExists: false };
}

module.exports = { requestSignUp, requestCompleteRegistration, buildRegistrationContext };
