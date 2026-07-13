'use strict';

/*
 * Legal disclaimer + EXPLICIT acceptance gate (skill-code-certification,
 * ADR-001), shown before ANY egress in `ai-certify`.
 *
 * ADR-001 (accepted with a MAXIMUM legal caveat): the certify flow sends the
 * Talent's project code to a server-side LLM — more invasive than anything
 * ai-footprint ever sent. The disclaimer ASSUMES the project is the Talent's
 * own and ATTRIBUTES responsibility to them (protects Shakers vs the Talent,
 * NOT vs a third party — hence secret/PII scrub is mandatory in the certify
 * phase, issue 005). Acceptance must be EXPLICIT: either an interactive y/n
 * confirmation, or the deliberate `--accept-disclaimer` flag (never implied
 * by any other flag). No acceptance -> no egress, the run aborts cleanly.
 *
 * NOTE: even the RESOLVE phase (issue 004) sends the Talent's email +
 * detected technology NAMES, so it too is egress and is gated here. This is
 * intentionally shown BEFORE resolve, not only before the heavier certify
 * phase.
 *
 * Decoupled from real stdin via an injectable `ask(question)` (same pattern
 * as src/consent-flow.js) so it's unit-testable without a TTY.
 */

const MAX_ATTEMPTS = 5;
const YES_RE = /^(y|yes|s|si|sí)$/i;
const NO_RE = /^(n|no)$/i;

function isAffirmative(raw) {
  return YES_RE.test(String(raw).trim());
}
function isNegative(raw) {
  return NO_RE.test(String(raw).trim());
}

// Returns { accepted, reason }:
//   reason: 'flag' (pre-accepted via --accept-disclaimer)
//         | 'interactive' (answered yes at the prompt)
//         | 'declined' (answered no)
//         | 'no-answer' (no recognizable answer within MAX_ATTEMPTS)
//         | 'non-interactive' (no TTY and no --accept-disclaimer -> can't
//           obtain explicit acceptance; abort rather than assume consent).
async function confirmDisclaimerAcceptance({ ask, catalog, preAccepted = false, stdinIsTTY = true }) {
  const d = catalog.certify;

  // The disclaimer TEXT is always shown, even when pre-accepting via flag —
  // the talent (or the script author who chose the flag) still sees what
  // they're accepting.
  process.stdout.write(`\n  ${d.disclaimer}\n`);

  if (preAccepted) {
    process.stdout.write(`  ${d.disclaimerAcceptedFlag}\n\n`);
    return { accepted: true, reason: 'flag' };
  }

  if (!stdinIsTTY) {
    process.stdout.write(`  ${d.disclaimerNonInteractive}\n\n`);
    return { accepted: false, reason: 'non-interactive' };
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const raw = String(await ask(d.disclaimerQuestion)).trim();
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
