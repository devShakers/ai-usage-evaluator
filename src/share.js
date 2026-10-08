'use strict';

const crypto = require('crypto');

const { getIngestEndpoint, isTalentProfile } = require('./config');
const { requestBackend } = require('./backend-request');
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

// POSTs `body` to the ONE backend (talents-ai-score, ADR-042 — the PRIMARY -> FALLBACK chain is retired), via src/backend-request.js.
async function requestJsonBackend(endpoint, body, { timeoutMs = 15000, idempotencyKey = null } = {}) {
  const { status, raw, backend } = await requestBackend({ endpoint, body, timeoutMs, idempotencyKey });
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { /* non-JSON response */ }
  return { status, json, raw, backend };
}

/* ---------- automatic sending ---------- */

async function autoShare(report, maturity, { root, bypassThrottle = false } = {}) {
  const state = loadConsentState();
  const decision = getConsentDecision(state);

  if (decision !== 'granted') {
    return { ok: false, skipped: true, reason: decision === 'denied' ? 'consent-denied' : 'no-decision' };
  }
  if (!state.email) {
    return { ok: false, skipped: true, reason: 'no-email' };
  }
  // ADR-006: never SEND under an email whose ownership wasn't proven.
  if (state.emailVerified === false && isTalentProfile()) {
    return { ok: false, skipped: true, reason: 'email-unverified' };
  }
  if (!bypassThrottle && isThrottled(state)) {
    return { ok: false, skipped: true, reason: 'throttled' };
  }

  const endpoint = getIngestEndpoint();
  if (!endpoint) {
    return { ok: false, skipped: true, reason: 'no-endpoint-configured' };
  }

  const payload = derivePayload(report, maturity);

  const idempotencyKey = crypto.randomUUID();
  let res;
  try {
    res = await requestJsonBackend(endpoint, { email: state.email, payload }, { idempotencyKey });
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
    // Generic "service unavailable" from the server (ADR-011 retires the
    // server-side kill switch that used to be the main 503 cause).
    return { ok: false, skipped: false, reason: 'service-unavailable' };
  }
  return { ok: false, skipped: false, reason: `http-${res.status}` };
}

/* ---------- certification persistence (skill-code-certification, issue 005) ---------- */

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
  // ADR-006 (mirror of autoShare): don't persist under an unverified email.
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
    // ADR-027: forward the superadmin session token so the backend stamps test_origin=true (server-authoritative, non-prod only).
    const body = { email: state.email, payload };
    if (superadminToken) body.superadminToken = superadminToken;
    // Idempotency-Key (three-way security review, cross-repo): ONE key per
    // logical certification-persist submission — same reasoning as autoShare.
    const idempotencyKey = crypto.randomUUID();
    res = await requestJsonBackend(endpoint, body, { idempotencyKey });
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
