'use strict';

/*
 * Explains WHY the consent-to-persist prompt is skipped (or might not
 * complete) this run, instead of doing so silently (talents-ai-score, DX).
 *
 * A user reported "I never see the consent/email prompt and don't know
 * why". Enumerated, in the order bin/report.js checks them:
 *
 *   1. `--json` mode. Handled entirely in bin/report.js — it returns
 *      before the consent block is ever reached, because stdout must stay
 *      a single parseable JSON document (an explanatory line would corrupt
 *      it). Not this module's concern; listed here for completeness.
 *   2. A consent decision is ALREADY persisted (`granted` or `denied`).
 *      BY FAR the most likely real-world cause in a normal, interactive
 *      terminal: the prompt is designed to run exactly ONCE per talent
 *      (issue 007 / ADR-007 / ADR-011) — any subsequent run on the same
 *      machine (same consent file, `AI_FOOTPRINT_CONFIG_DIR` or the
 *      default `~/.config/ai-footprint/consent.json`) never asks again.
 *      This is a deliberate design decision, not a bug — but it was never
 *      explained, so it read as "broken". `computeConsentSkip` returns
 *      `skip: true` and a message naming the exact file and the flags to
 *      inspect/change it (`--consent-status` / `--consent-revoke`).
 *   3. stdin is not a TTY (piped/redirected/non-interactive). Deliberately
 *      NOT a blanket "non-TTY -> skip" rule: piping a scripted answer
 *      (`printf "y\nme@x.com\n" | ai-footprint`) is a legitimate, already
 *      -tested way to answer non-interactively and must keep working —
 *      `skip` stays `false` here. What's returned instead is an
 *      informational warning, printed BEFORE attempting the prompt, so a
 *      script/CI user understands what will happen if stdin turns out to
 *      have nothing to give (see src/stdin-ask.js's `markEnded` for the
 *      companion fix: that case now resolves to "no answer obtained"
 *      instead of hanging forever).
 *
 * Confirmed NOT a skip condition (verified by reading bin/report.js):
 * `--no-save` only controls whether the report is written to disk
 * locally; it has no bearing on the consent-to-persist prompt at all.
 *
 * Pure function — `stdinIsTTY`/`consentFilePath`/`catalog` are all passed
 * in (never reads `process.stdin` itself) so this is fully unit-testable
 * without a real TTY/process.
 */
function computeConsentSkip({ decision, stdinIsTTY, consentFilePath, catalog } = {}) {
  const c = catalog && catalog.consent;

  if (decision === 'granted' || decision === 'denied') {
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
