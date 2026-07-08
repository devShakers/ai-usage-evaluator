'use strict';

const { isValidEmail, recordConsent } = require('./share');

/*
 * Interactive disclosure + consent + email collection (talents-ai-score,
 * ADR-007, issue 006). Runs ONCE per talent: only when there's no persisted
 * consent decision yet (`share.getConsentDecision(share.loadConsentState())`
 * is null). Decoupled from real stdin via an injectable `ask(question)`
 * function so it can be unit-tested without a TTY.
 *
 * This module only DECIDES and PERSISTS the consent decision + email. It
 * never sends anything itself: sending stays the job of
 * `share.js#autoShare`, invoked the same way on every run (the very first
 * grant included) — one send code path, not two.
 */

// Defensive cap, not a product requirement: if a talent can't produce a
// recognizable yes/no or a well-formed email after this many attempts,
// NOTHING is persisted (the disclosure runs again next time) rather than
// guessing a decision on their behalf.
const MAX_ATTEMPTS = 5;

const YES_RE = /^(y|yes|s|si|sí)$/i;
const NO_RE = /^(n|no)$/i;

function disclosureText(catalog) {
  const c = catalog.consent;
  return [
    '',
    `  ${c.disclosureTitle}`,
    '',
    `  ${c.sendsHeading}`,
    ...c.sendsList.map((line) => `    - ${line}`),
    '',
    `  ${c.neverSendsHeading}`,
    ...c.neverSendsList.map((line) => `    - ${line}`),
    '',
    `  ${c.purpose}`,
    `  ${c.indicativeNotice}`,
    `  ${c.revocableNotice}`,
    '',
    `  ${c.legalPlaceholder}`,
    '',
  ].join('\n');
}

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

// Runs the disclosure + consent + (if accepted) email prompt.
// Returns the resulting decision: 'granted' | 'denied' | null.
// `null` means no valid answer was obtained within MAX_ATTEMPTS: nothing is
// persisted, so the disclosure shows again on the next run — the CLI never
// sends without an explicit, well-formed `granted` decision.
async function runDisclosureFlow({ ask, catalog }) {
  process.stdout.write(disclosureText(catalog));

  const accepted = await askYesNo(ask, catalog.consent.consentQuestion, catalog);
  if (accepted === null) {
    process.stdout.write(`  ${catalog.consent.notObtained}\n\n`);
    return null;
  }

  if (!accepted) {
    recordConsent('denied');
    process.stdout.write(`  ${catalog.consent.deniedSaved}\n\n`);
    return 'denied';
  }

  const email = await askEmail(ask, catalog);
  if (!email) {
    process.stdout.write(`  ${catalog.consent.notObtained}\n\n`);
    return null;
  }

  recordConsent('granted', email);
  process.stdout.write(`  ${catalog.consent.grantedSaved(email)}\n\n`);
  return 'granted';
}

module.exports = { runDisclosureFlow, disclosureText };
