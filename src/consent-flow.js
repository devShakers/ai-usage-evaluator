'use strict';

const { isValidEmail, recordConsent } = require('./share');

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

// Runs the short consent-to-persist prompt + (if accepted) email collection.
// Returns the resulting decision: 'granted' | 'denied' | null.
// `null` means no valid answer was obtained within MAX_ATTEMPTS: nothing is
// persisted, so the prompt shows again on the next run — the CLI never
// persists without an explicit, well-formed `granted` decision. Caller
// (bin/report.js) is expected to invoke this AFTER the local report has
// already been rendered and shown — never before, never as a gate on it.
async function runConsentPrompt({ ask, catalog }) {
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

  recordConsent('granted', email);
  process.stdout.write(`  ${c.grantedSaved(email)}\n\n`);
  return 'granted';
}

module.exports = { runConsentPrompt };
