'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseArgs } = require('../src/cli-args');

/*
 * talents-ai-score / ADR-007: --enroll and --consent on|off are RETIRED.
 * This file asserts both the base flags still work AND that the retired
 * ones leave no trace in the parser (they degrade to no-ops rather than
 * being silently accepted).
 */

test('parseArgs: defaults', () => {
  const opts = parseArgs([]);
  assert.equal(opts.html, false);
  assert.equal(opts.json, false);
  assert.equal(opts.save, true);
  assert.equal(opts.root, null);
  assert.equal(opts.help, false);
});

test('parseArgs: --html/-w, --json, --no-save, --root', () => {
  assert.equal(parseArgs(['--html']).html, true);
  assert.equal(parseArgs(['-w']).html, true);
  assert.equal(parseArgs(['--json']).json, true);
  assert.equal(parseArgs(['--no-save']).save, false);
  assert.equal(parseArgs(['--root', '../other']).root, '../other');
});

test('parseArgs: --help/-h', () => {
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-h']).help, true);
});

test('parseArgs: retired --enroll and --consent on|off do NOT set any option (no enroll/consent-flag fields exist)', () => {
  const opts = parseArgs(['--enroll', 'SOMECODE']);
  assert.equal('enroll' in opts, false);
  const opts2 = parseArgs(['--consent', 'on']);
  assert.equal('consent' in opts2, false);
  // Neither is mistaken for --root or another flag consuming the next arg.
  assert.equal(opts.root, null);
  assert.equal(opts2.root, null);
});

// --- issue 007: consent management flags ---

test('parseArgs: --consent-status', () => {
  assert.equal(parseArgs(['--consent-status']).consentStatus, true);
  assert.equal(parseArgs([]).consentStatus, false);
});

test('parseArgs: --consent-revoke', () => {
  assert.equal(parseArgs(['--consent-revoke']).consentRevoke, true);
  assert.equal(parseArgs([]).consentRevoke, false);
});

test('parseArgs: --consent-reset (ADR-003, distinct from revoke)', () => {
  assert.equal(parseArgs(['--consent-reset']).consentReset, true);
  assert.equal(parseArgs([]).consentReset, false);
  // independent flags
  assert.equal(parseArgs(['--consent-reset']).consentRevoke, false);
});

test('parseArgs: --consent-email (space and = forms)', () => {
  assert.equal(parseArgs(['--consent-email', 'a@b.com']).consentEmail, 'a@b.com');
  assert.equal(parseArgs(['--consent-email=a@b.com']).consentEmail, 'a@b.com');
  assert.equal(parseArgs([]).consentEmail, null);
});

// --- issue 021: "construir el siguiente nivel ahora" -------------------------

test('parseArgs: --build-next-level (optional phase, does not scan on its own)', () => {
  assert.equal(parseArgs(['--build-next-level']).buildNextLevel, true);
  assert.equal(parseArgs([]).buildNextLevel, false);
});

test('parseArgs: --force (only meaningful alongside --build-next-level)', () => {
  assert.equal(parseArgs(['--build-next-level', '--force']).force, true);
  assert.equal(parseArgs([]).force, false);
});

// --- report/prompt language override (talents-ai-score, item 3: the
// implementation prompt needs an explicit, choosable language, decoupled
// from OS-locale auto-detection; --lang overrides the WHOLE report's
// language, the prompt included, for one clean, single language axis) ---

test('parseArgs: --lang es|en overrides the auto-detected report language; unset -> null (auto-detect stays default)', () => {
  assert.equal(parseArgs(['--lang', 'es']).lang, 'es');
  assert.equal(parseArgs(['--lang', 'en']).lang, 'en');
  assert.equal(parseArgs([]).lang, null);
});

test('parseArgs: --lang= form also works', () => {
  assert.equal(parseArgs(['--lang=en']).lang, 'en');
});

test('parseArgs: an unrecognized --lang value is ignored (null), never a made-up language', () => {
  assert.equal(parseArgs(['--lang', 'fr']).lang, null);
  assert.equal(parseArgs(['--lang=de']).lang, null);
});
