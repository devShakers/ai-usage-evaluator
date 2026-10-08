'use strict';

const { isValidEmail, recordConsent } = require('./share');
const {
  getEmailVerificationRequestUrl,
  getEmailVerificationVerifyUrl,
} = require('./config');
const { runEmailVerification } = require('./email-verification');
const { renderLegalNotice } = require('./legal-notice');

// Consent prompt (talents-ai-score, ADR-011 — revises issue 006 / ADR-007's disclosure wall; ADR-051 revises ADR-011's OWN ordering in turn, see below).

const MAX_ATTEMPTS = 5;

const YES_RE = /^(y|yes|s|si|sí)$/i;
const NO_RE = /^(n|no)$/i;

async function askYesNo(ask, question, catalog) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const raw = String(await ask(question)).trim();
    if (YES_RE.test(raw)) return true;
    if (NO_RE.test(raw)) return false;
    process.stdout.write(`  ${catalog.consent.invalidAnswer}\n`);
  }
  return null;
}

async function askEmail(ask, catalog, question = catalog.consent.emailPrompt) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const raw = String(await ask(question)).trim();
    if (isValidEmail(raw)) return raw;
    process.stdout.write(`  ${catalog.consent.invalidEmail}\n`);
  }
  return null;
}

async function defaultVerifyEmail({ email, ask, catalog, env = process.env }) {
  return runEmailVerification({
    email,
    ask,
    catalog,
    requestUrl: getEmailVerificationRequestUrl(env),
    verifyUrl: getEmailVerificationVerifyUrl(env),
  });
}

// Runs the short consent-to-persist prompt + (if accepted) email collection + (skill-code-certification / ADR-006) EMAIL-OWNERSHIP VERIFICATION.
async function runConsentPrompt({
  ask,
  catalog,
  env = process.env,
  verifyEmail = defaultVerifyEmail,
  loggedIn = false,
  sessionEmail = null,
  drainBeforeAsk = false,
  profile = 'talent',
}) {
  const c = catalog.consent;
  // Presentation only (talents-ai-score): framed by src/legal-notice.js on a
  // real TTY, byte-identical (no heading, no rule) otherwise.
  process.stdout.write(`\n  ${renderLegalNotice(c.persistIntro, catalog)}\n`);

  if (drainBeforeAsk && typeof ask.drain === 'function') ask.drain();

  const accepted = await askYesNo(ask, c.persistQuestion, catalog);
  if (accepted === null) {
    process.stdout.write(`  ${c.notObtained}\n\n`);
    return null;
  }

  if (!accepted) {
    recordConsent('denied');
    process.stdout.write(`  ${c.deniedSaved}\n\n`);
    return 'denied';
  }

  if (loggedIn) {
    if (sessionEmail && isValidEmail(sessionEmail)) {
      // Identity already proven by the login session — no email prompt, no OTP.
      recordConsent('granted', sessionEmail, { verified: true });
      process.stdout.write(`  ${c.grantedSaved(sessionEmail)}\n\n`);
      return 'granted';
    }
    // Logged in, but this session has no cached email — only happens against an older certs deployment that omitted `email` from the login response (see auth-session-store.js).
    process.stdout.write(`  ${c.noSessionEmail}\n\n`);
    return null;
  }

  const email = await askEmail(ask, catalog, profile === 'external' ? c.emailPromptExternal : undefined);
  if (!email) {
    process.stdout.write(`  ${c.notObtained}\n\n`);
    return null;
  }

  if (profile === 'external') {
    recordConsent('granted', email, { verified: false });
    process.stdout.write(`  ${c.grantedSavedExternal(email)}\n\n`);
    return 'granted';
  }

  // Prove email ownership BEFORE persisting anything (ADR-006).
  const verification = await verifyEmail({ email, ask, catalog, env });
  if (verification && verification.verified) {
    recordConsent('granted', email, { verified: true });
    process.stdout.write(`  ${c.grantedSaved(email)}\n\n`);
    return 'granted';
  }

  // Not verified: persist nothing, re-ask next run. runEmailVerification
  // already printed the specific reason (cancelled / technical / exhausted).
  process.stdout.write(`  ${c.notObtained}\n\n`);
  return null;
}

module.exports = { runConsentPrompt, defaultVerifyEmail };
