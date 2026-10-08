'use strict';

// Explains WHY the consent-to-persist prompt is skipped (or might not complete) this run, instead of doing so silently (talents-ai-score, DX).
function computeConsentSkip({ decision, emailVerified, stdinIsTTY, consentFilePath, catalog } = {}) {
  const c = catalog && catalog.consent;

  // Only a TERMINAL decision is skippable: an explicit DECLINE, or a GRANT whose email ownership was actually verified.
  const terminal =
    decision === 'denied' ||
    (decision === 'granted' && emailVerified !== false);

  if (terminal) {
    const message = c && typeof c.skipAlreadyDecided === 'function'
      ? c.skipAlreadyDecided(decision, consentFilePath)
      : null;
    return { skip: true, message };
  }

  if (!stdinIsTTY) {
    const message = c ? c.nonInteractiveWarning || null : null;
    return { skip: false, message };
  }

  return { skip: false, message: null };
}

module.exports = { computeConsentSkip };
