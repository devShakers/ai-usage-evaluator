'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeConsentSkip } = require('../src/consent-skip');
const { getCatalog } = require('../src/i18n');

/*
 * talents-ai-score, DX: makes visible WHY the consent-to-persist prompt is
 * skipped, instead of silently doing nothing. Enumerated conditions (see
 * src/consent-skip.js header):
 *   1. `--json` mode (checked/handled entirely in bin/report.js, before this
 *      module is ever reached — not this module's concern).
 *   2. A decision is ALREADY persisted (granted or denied) -> skip=true.
 *   3. stdin is not a TTY -> skip=false (a piped answer is still legitimate
 *      and must still work), but an informational warning is returned.
 *   4. Confirmed NOT a skip condition: `--no-save` has no bearing here at
 *      all (verified by reading bin/report.js — it only gates local disk
 *      writes).
 */

const catalogEs = getCatalog('es');
const catalogEn = getCatalog('en');

test('computeConsentSkip: no decision yet, real TTY -> does not skip, no warning', () => {
  const result = computeConsentSkip({
    decision: null,
    stdinIsTTY: true,
    consentFilePath: '/tmp/consent.json',
    catalog: catalogEs,
  });
  assert.equal(result.skip, false);
  assert.equal(result.message, null);
});

test('computeConsentSkip: decision already GRANTED -> skips, message names the file path and the management flags', () => {
  const result = computeConsentSkip({
    decision: 'granted',
    stdinIsTTY: true,
    consentFilePath: '/home/talent/.config/ai-footprint/consent.json',
    catalog: catalogEs,
  });
  assert.equal(result.skip, true);
  assert.match(result.message, /concedido/);
  assert.match(result.message, /\/home\/talent\/\.config\/ai-footprint\/consent\.json/);
  assert.match(result.message, /--consent-status/);
  assert.match(result.message, /--consent-revoke/);
});

test('computeConsentSkip: decision already DENIED -> skips, message reflects the denied decision', () => {
  const result = computeConsentSkip({
    decision: 'denied',
    stdinIsTTY: true,
    consentFilePath: '/tmp/consent.json',
    catalog: catalogEs,
  });
  assert.equal(result.skip, true);
  assert.match(result.message, /rechazado/);
});

test('computeConsentSkip: no decision, non-TTY stdin -> does NOT skip (a piped answer is still legitimate), but returns a warning', () => {
  const result = computeConsentSkip({
    decision: null,
    stdinIsTTY: false,
    consentFilePath: '/tmp/consent.json',
    catalog: catalogEs,
  });
  assert.equal(result.skip, false);
  assert.match(result.message, /no-TTY/);
});

test('computeConsentSkip: an already-persisted decision takes priority over the non-TTY warning (both true -> still just skips)', () => {
  const result = computeConsentSkip({
    decision: 'granted',
    stdinIsTTY: false,
    consentFilePath: '/tmp/consent.json',
    catalog: catalogEs,
  });
  assert.equal(result.skip, true);
  assert.match(result.message, /concedido/);
});

test('computeConsentSkip: works in English too', () => {
  const result = computeConsentSkip({
    decision: 'granted',
    stdinIsTTY: true,
    consentFilePath: '/tmp/consent.json',
    catalog: catalogEn,
  });
  assert.match(result.message, /granted/);
  assert.match(result.message, /--consent-status/);
});

test('computeConsentSkip: never throws on malformed input', () => {
  assert.doesNotThrow(() => computeConsentSkip({}));
  assert.doesNotThrow(() => computeConsentSkip({ catalog: catalogEs }));
});
