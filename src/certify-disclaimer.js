'use strict';

// Legal disclaimer + EXPLICIT acceptance gate (ADR-001), shown before egress. Skill-code certify was retired (certify is now a dimension LiveKit interview); consumers today are the add-skill/add-agent/add-project consent gates.

const { renderLegalNotice } = require('./legal-notice');
const { styleQuestion } = require('./ansi');

const MAX_ATTEMPTS = 5;
const YES_RE = /^(y|yes|s|si|sí)$/i;
const NO_RE = /^(n|no)$/i;

function isAffirmative(raw) {
  return YES_RE.test(String(raw).trim());
}
function isNegative(raw) {
  return NO_RE.test(String(raw).trim());
}

async function confirmDisclaimerAcceptance({ ask, catalog, preAccepted = false, stdinIsTTY = true, text = null, drainBeforeAsk = false }) {
  const d = catalog.certify;
  const shown = text || d.disclaimer;

  // The disclaimer TEXT is always shown, even when pre-accepting via flag — the talent (or the script author who chose the flag) still sees what they're accepting.
  process.stdout.write(`\n  ${renderLegalNotice(shown, catalog)}\n`);

  if (preAccepted) {
    process.stdout.write(`  ${d.disclaimerAcceptedFlag}\n\n`);
    return { accepted: true, reason: 'flag' };
  }

  if (!stdinIsTTY) {
    process.stdout.write(`  ${d.disclaimerNonInteractive}\n\n`);
    return { accepted: false, reason: 'non-interactive' };
  }

  if (drainBeforeAsk && typeof ask.drain === 'function') ask.drain();

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const raw = String(await ask(styleQuestion(d.disclaimerQuestion))).trim();
    if (isAffirmative(raw)) return { accepted: true, reason: 'interactive' };
    if (isNegative(raw)) {
      process.stdout.write(`  ${d.disclaimerDeclined}\n\n`);
      return { accepted: false, reason: 'declined' };
    }
    process.stdout.write(`  ${d.disclaimerInvalidAnswer}\n`);
  }
  process.stdout.write(`  ${d.disclaimerNoAnswer}\n\n`);
  return { accepted: false, reason: 'no-answer' };
}

module.exports = { confirmDisclaimerAcceptance, isAffirmative, isNegative };
