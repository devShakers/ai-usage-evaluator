'use strict';

// Consent state + email identity + client-side throttle, extracted from src/share.js (structure refactor, issue 020).

const fs = require('fs');
const path = require('path');
const { getConfigDir } = require('./config-dir');

function configDir() {
  return getConfigDir(process.env);
}

function consentPath() {
  return path.join(configDir(), 'consent.json');
}

// Client-side throttle: don't retry a submission if the last one was less than 1h ago.
const SEND_THROTTLE_MS = 60 * 60 * 1000;

// consent state (~/.config/ai-footprint/consent.json) Replaces the old `credentials.json` (token model).

function loadConsentState() {
  try {
    return JSON.parse(fs.readFileSync(consentPath(), 'utf8'));
  } catch {
    return null;
  }
}

function saveConsentState(state) {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(consentPath(), JSON.stringify(state, null, 2));
  try { fs.chmodSync(consentPath(), 0o600); } catch { /* e.g. Windows */ }
}

// Returns 'granted' | 'denied' | null ("no decision persisted yet").
function getConsentDecision(state) {
  if (!state || state.consent === undefined || state.consent === null) return null;
  return state.consent;
}

function hasTraceContentConsent() {
  return getConsentDecision(loadConsentState()) === 'granted';
}

/* ---------- email ---------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Basic format validation only (specs.md: "validación de formato básica").
function isValidEmail(value) {
  return typeof value === 'string' && EMAIL_RE.test(value.trim());
}

// Same normalization the backend applies (specs.md Data model): trim +
// lowercase, so client and server agree on what "the same email" means.
function normalizeEmail(value) {
  return String(value).trim().toLowerCase();
}

// Persists a consent decision.
function recordConsent(decision, email = null, { verified } = {}) {
  if (decision !== 'granted' && decision !== 'denied') {
    throw new Error(`Decisión de consentimiento no válida: ${decision}`);
  }
  if (decision === 'granted' && !isValidEmail(email)) {
    throw new Error('No se puede conceder consentimiento sin un correo válido.');
  }
  const state = loadConsentState() || {};
  state.consent = decision;
  if (email !== null) state.email = normalizeEmail(email);
  if (state.lastSentAt === undefined) state.lastSentAt = null;
  // Email-ownership verification flag (skill-code-certification / ADR-006).
  if (decision === 'granted' && verified !== undefined) {
    state.emailVerified = verified === true;
  }
  saveConsentState(state);
  return state;
}

// consent management (issue 007: status / revoke / change email) One-shot actions (do not scan), same pattern the retired `--enroll` used.

// Read-only snapshot for `--consent-status`. Never throws.
function getConsentStatus() {
  const state = loadConsentState();
  return {
    consent: getConsentDecision(state),
    email: state && state.email ? state.email : null,
    emailVerified: state ? state.emailVerified !== false : false,
    lastSentAt: state && state.lastSentAt ? state.lastSentAt : null,
  };
}

// Revokes consent unconditionally (works even with no prior decision, or after a prior `denied` — idempotent): from this point on `autoShare` skips with `consent-denied`.
function revokeConsent() {
  const state = recordConsent('denied');
  return { ok: true, state };
}

function resetConsent() {
  const state = loadConsentState() || {};
  delete state.consent;
  // A re-grant is "concede de cero" (ADR-006): drop the verification flag so the OTP runs again from scratch and nothing is sent under the old email until it's re-verified.
  delete state.emailVerified;
  if (state.lastSentAt === undefined) state.lastSentAt = null;
  saveConsentState(state);
  return { ok: true, state };
}

function clearConsentState() {
  try {
    fs.rmSync(consentPath(), { force: true });
  } catch { /* no-op */ }
  return { ok: true };
}

// Changes the persisted email WITHOUT touching the consent decision (specs.md: "sin tocar la decisión de consentimiento").
function setEmail(newEmail) {
  if (!isValidEmail(newEmail)) {
    return { ok: false, reason: 'invalid-email' };
  }
  const state = loadConsentState() || {};
  state.email = normalizeEmail(newEmail);
  // A new email is unverified until proven (ADR-006): reset the flag so
  // autoShare won't send under an address whose ownership wasn't checked.
  state.emailVerified = false;
  saveConsentState(state);
  return { ok: true, state };
}

/* ---------- client-side throttle ---------- */

function isThrottled(state, now = Date.now()) {
  if (!state || !state.lastSentAt) return false;
  const last = new Date(state.lastSentAt).getTime();
  if (Number.isNaN(last)) return false;
  return now - last < SEND_THROTTLE_MS;
}

module.exports = {
  configDir,
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
};
