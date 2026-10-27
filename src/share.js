'use strict';

const crypto = require('crypto');

const { getIngestEndpoint } = require('./config');
const { requestBackend } = require('./backend-request');
const { loadAuthSession, decodeJwtPayload } = require('./auth-session-store');
const { ensureFreshSession } = require('./session-refresh');
const { recordBackendAcceptance } = require('./report-store');
const {
  consentPath,
  SEND_THROTTLE_MS,
  loadConsentState,
  saveConsentState,
  getConsentDecision,
  hasTraceContentConsent,
  isValidEmail,
  normalizeEmail,
  recordConsent,
  getConsentStatus,
  revokeConsent,
  resetConsent,
  clearConsentState,
  setEmail,
  isThrottled,
} = require('./share-consent-state');
const { derivePayload } = require('./share-payload');
const {
  deriveCertificationPayload,
  isCertifyThrottled,
  CERTIFY_SEND_THROTTLE_MS,
} = require('./share-certification');

// Sharing (= PERSISTENCE) layer — the thin transport + orchestration.

/* ---------- minimal HTTP utility (no dependencies) ---------- */

// POSTs `body` to the ONE backend (the PRIMARY -> FALLBACK chain is retired), via src/backend-request.js.
async function requestJsonBackend(endpoint, body, { timeoutMs = 15000, idempotencyKey = null, extraHeaders = null } = {}) {
  const { status, raw, backend } = await requestBackend({ endpoint, body, timeoutMs, idempotencyKey, extraHeaders });
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { /* non-JSON response */ }
  return { status, json, raw, backend };
}

async function talentSessionHeaders(now = Date.now()) {
  let session = null;
  try {
    session = (await ensureFreshSession()) || loadAuthSession();
  } catch {
    try { session = loadAuthSession(); } catch { session = null; }
  }
  const token = session && typeof session.hubAccessToken === 'string' ? session.hubAccessToken : null;
  const payload = decodeJwtPayload(token);
  const exp = payload && typeof payload.exp === 'number' ? payload.exp * 1000 : NaN;
  return Number.isFinite(exp) && exp > now ? { Authorization: `Bearer ${token}` } : null;
}

/* ---------- automatic sending ---------- */

async function autoShare(report, maturity, { root, bypassThrottle = false, cliCommandId = null, client = null } = {}) {
  const state = loadConsentState();
  const decision = getConsentDecision(state);

  if (decision !== 'granted') {
    return { ok: false, skipped: true, reason: decision === 'denied' ? 'consent-denied' : 'no-decision' };
  }
  if (!state.email) {
    return { ok: false, skipped: true, reason: 'no-email' };
  }
  // Never SEND under an email whose ownership wasn't proven — every
  // profile, `external` included (legal requirement), must have verified.
  if (state.emailVerified === false) {
    return { ok: false, skipped: true, reason: 'email-unverified' };
  }
  if (!bypassThrottle && isThrottled(state)) {
    return { ok: false, skipped: true, reason: 'throttled' };
  }

  const endpoint = getIngestEndpoint();
  if (!endpoint) {
    return { ok: false, skipped: true, reason: 'no-endpoint-configured' };
  }

  const payload = derivePayload(report, maturity, { cliCommandId, client });

  const idempotencyKey = crypto.randomUUID();
  let res;
  try {
    const extraHeaders = await talentSessionHeaders();
    res = await requestJsonBackend(endpoint, { email: state.email, payload }, { idempotencyKey, extraHeaders });
  } catch (e) {
    // Network failure (on every hop): doesn't break the local report.
    return { ok: false, skipped: false, reason: 'network-error', error: e.message };
  }

  if (res.status >= 200 && res.status < 300) {
    state.lastSentAt = new Date().toISOString();
    saveConsentState(state);
    try {
      recordBackendAcceptance({ root, kind: 'footprint', backend: res.backend });
    } catch {
      // Never break the send over a failed local state write.
    }
    return { ok: true, response: res.json, backend: res.backend };
  }
  if (res.status === 429) {
    return { ok: false, skipped: false, reason: 'rate-limited' };
  }
  if (res.status === 503) {
    // Generic "service unavailable" from the server (the retired
    // server-side kill switch used to be the main 503 cause).
    return { ok: false, skipped: false, reason: 'service-unavailable' };
  }
  return { ok: false, skipped: false, reason: `http-${res.status}` };
}

/* ---------- certification persistence ---------- */

// Persists the analyzed certification result if (and only if) consent is granted.
async function shareCertification(items, { repository = null, commitRange = null, toolVersion = null, superadminToken = null, root = null } = {}) {
  const state = loadConsentState();
  const decision = getConsentDecision(state);

  if (decision !== 'granted') {
    return { ok: false, skipped: true, reason: decision === 'denied' ? 'consent-denied' : 'no-decision' };
  }
  if (!state.email) {
    return { ok: false, skipped: true, reason: 'no-email' };
  }
  // Don't persist under an unverified email.
  if (state.emailVerified === false) {
    return { ok: false, skipped: true, reason: 'email-unverified' };
  }
  if (isCertifyThrottled(state)) {
    return { ok: false, skipped: true, reason: 'throttled' };
  }

  const payload = deriveCertificationPayload(items, { repository, commitRange, toolVersion });
  if (payload.skillCodeAssessments.length === 0) {
    return { ok: false, skipped: true, reason: 'nothing-to-persist' };
  }

  const endpoint = getIngestEndpoint();
  if (!endpoint) {
    return { ok: false, skipped: true, reason: 'no-endpoint-configured' };
  }

  let res;
  try {
    // Forward the superadmin session token so the backend stamps test_origin=true (server-authoritative, non-prod only).
    const body = { email: state.email, payload };
    if (superadminToken) body.superadminToken = superadminToken;
    // Idempotency-Key (three-way security review, cross-repo): ONE key per
    // logical certification-persist submission — same reasoning as autoShare.
    const idempotencyKey = crypto.randomUUID();
    const extraHeaders = superadminToken ? null : await talentSessionHeaders();
    res = await requestJsonBackend(endpoint, body, { idempotencyKey, extraHeaders });
  } catch (e) {
    return { ok: false, skipped: false, reason: 'network-error', error: e.message };
  }

  if (res.status >= 200 && res.status < 300) {
    state.lastCertifySentAt = new Date().toISOString();
    saveConsentState(state);
    try {
      recordBackendAcceptance({ root, kind: 'certification', backend: res.backend });
    } catch {
      // Never break the send over a failed local state write.
    }
    return { ok: true, response: res.json, backend: res.backend };
  }
  if (res.status === 429) {
    return { ok: false, skipped: false, reason: 'rate-limited' };
  }
  return { ok: false, skipped: false, reason: `http-${res.status}` };
}

module.exports = {
  autoShare,
  deriveCertificationPayload,
  shareCertification,
  isCertifyThrottled,
  CERTIFY_SEND_THROTTLE_MS,
  loadConsentState,
  saveConsentState,
  getConsentDecision,
  hasTraceContentConsent,
  recordConsent,
  getConsentStatus,
  revokeConsent,
  resetConsent,
  clearConsentState,
  setEmail,
  isValidEmail,
  normalizeEmail,
  isThrottled,
  derivePayload,
  requestJsonBackend,
  consentPath,
  SEND_THROTTLE_MS,
};
