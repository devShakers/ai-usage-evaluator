'use strict';

const { isValidEmail, recordConsent } = require('./share');
const { getEmailVerificationRequestUrl, getEmailVerificationVerifyUrl } = require('./config');
const { runEmailVerification } = require('./email-verification');

/*
 * Consent-to-PERSIST prompt (talents-ai-score, ADR-011 — revises issue 006 /
 * ADR-007's disclosure wall).
 *
 * ADR-011's model: the local report is ALWAYS computed and shown,
 * unconditionally (bin/report.js does that first, every run, no gate). This
 * module no longer runs before scanning and no longer shows an itemized
 * "sends / never sends" wall — that disclosure now lives in the repo's
 * README (the talent already read it, or can, before installing/running a
 * public CLI). What's left here is a SHORT, one-time question, asked AFTER
 * the report is already on screen: do you want this report PERSISTED
 * (saved) in Shakers? Runs ONCE per talent — only when there's no persisted
 * consent decision yet
 * (`share.getConsentDecision(share.loadConsentState())` is null).
 * Decoupled from real stdin via an injectable `ask(question)` function so
 * it can be unit-tested without a TTY.
 *
 * This module only DECIDES and PERSISTS the consent decision + email. It
 * never sends anything itself: sending stays the job of
 * `share.js#autoShare`, invoked the same way on every run (the very first
 * grant included) — one send code path, not two.
 */

// Defensive cap, not a product requirement: if a talent can't produce a
// recognizable yes/no or a well-formed email after this many attempts,
// NOTHING is persisted (the prompt runs again next time) rather than
// guessing a decision on their behalf.
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

async function askEmail(ask, catalog) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const raw = String(await ask(catalog.consent.emailPrompt)).trim();
    if (isValidEmail(raw)) return raw;
    process.stdout.write(`  ${catalog.consent.invalidEmail}\n`);
  }
  return null;
}

// Default email-ownership verification (skill-code-certification / ADR-006):
// binds the wait-mode OTP loop to the endpoints DERIVED from the ingest URL
// (src/config.js — no new env var). Injectable via runConsentPrompt's
// `verifyEmail` option so the consent tests never touch the network.
async function defaultVerifyEmail({ email, ask, catalog }) {
  return runEmailVerification({
    email,
    ask,
    catalog,
    requestUrl: getEmailVerificationRequestUrl(),
    verifyUrl: getEmailVerificationVerifyUrl(),
  });
}

// Runs the short consent-to-persist prompt + (if accepted) email collection +
// (skill-code-certification / ADR-006) EMAIL-OWNERSHIP VERIFICATION.
// Returns the resulting decision: 'granted' | 'denied' | null.
// `null` means no TERMINAL decision was reached (unrecognized yes/no, malformed
// email, or a FAILED/CANCELLED/EXPIRED verification — incl. Ctrl-C at the OTP
// prompt): NOTHING is persisted, so the prompt shows again on the next run. The
// CLI only ever persists a decision that reached a terminal state: an explicit
// DECLINE, or a GRANT whose email ownership was actually VERIFIED. An
// interrupted consent is not a decision.
//
// The verification gates PERSISTENCE ONLY (ADR-003/ADR-006): the caller
// (bin/report.js, bin/certify.js) invokes this AFTER the local report has
// already been rendered and shown — never before, never as a gate on it. A
// Talent who declines to verify still saw their report; it just isn't saved.
// `verifyEmail` is injectable for tests (defaults to the ingest-derived flow).
async function runConsentPrompt({ ask, catalog, verifyEmail = defaultVerifyEmail }) {
  const c = catalog.consent;
  process.stdout.write(`\n  ${c.persistIntro}\n`);

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

  const email = await askEmail(ask, catalog);
  if (!email) {
    process.stdout.write(`  ${c.notObtained}\n\n`);
    return null;
  }

  // Prove email ownership BEFORE persisting anything (ADR-006). A grant is only
  // TERMINAL — and only then remembered and skippable on future runs — once
  // ownership is verified. We deliberately do NOT persist the grant up front:
  // if the Talent aborts here (Ctrl-C / empty line / EOF at the OTP prompt) or
  // verification fails (backend down, expired, exhausted), NOTHING is written,
  // so the next run re-asks from the start. An interrupted consent must never
  // be remembered as a valid, skippable decision. The dev/stub backend logs the
  // code locally, so a Talent who wants to persist can always complete this;
  // the report itself was/will still be shown regardless (ADR-003).
  const verification = await verifyEmail({ email, ask, catalog });
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

module.exports = { runConsentPrompt };
