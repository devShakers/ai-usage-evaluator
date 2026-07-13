'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { confirmDisclaimerAcceptance, isAffirmative, isNegative } = require('../src/certify-disclaimer');
const { getCatalog } = require('../src/i18n');

/*
 * skill-code-certification, ADR-001: the legal disclaimer gate. Acceptance
 * must be EXPLICIT (interactive y/n or the --accept-disclaimer flag); no
 * acceptance -> no egress. The disclaimer TEXT is always shown, even when
 * pre-accepting via flag.
 */

const en = getCatalog('en');

// Captures process.stdout.write for the duration of `fn`.
async function captureStdout(fn) {
  const original = process.stdout.write;
  let out = '';
  process.stdout.write = (chunk) => { out += chunk; return true; };
  try {
    const value = await fn();
    return { value, out };
  } finally {
    process.stdout.write = original;
  }
}

// Queue-backed injectable ask.
function askFrom(answers) {
  const q = [...answers];
  return async () => (q.length ? q.shift() : '');
}

test('isAffirmative / isNegative recognize es+en yes/no', () => {
  for (const y of ['y', 'yes', 's', 'si', 'sí', 'Y']) assert.equal(isAffirmative(y), true);
  for (const n of ['n', 'no', 'N']) assert.equal(isNegative(n), true);
  assert.equal(isAffirmative('maybe'), false);
  assert.equal(isNegative('maybe'), false);
});

test('confirmDisclaimerAcceptance: --accept-disclaimer -> accepted (reason flag), disclaimer STILL shown', async () => {
  const { value, out } = await captureStdout(() =>
    confirmDisclaimerAcceptance({ ask: askFrom([]), catalog: en, preAccepted: true, stdinIsTTY: false }),
  );
  assert.deepEqual(value, { accepted: true, reason: 'flag' });
  assert.match(out, /LEGAL DISCLAIMER/);
});

test('confirmDisclaimerAcceptance: interactive yes -> accepted', async () => {
  const { value } = await captureStdout(() =>
    confirmDisclaimerAcceptance({ ask: askFrom(['y']), catalog: en, stdinIsTTY: true }),
  );
  assert.deepEqual(value, { accepted: true, reason: 'interactive' });
});

test('confirmDisclaimerAcceptance: interactive no -> declined, nothing sent', async () => {
  const { value } = await captureStdout(() =>
    confirmDisclaimerAcceptance({ ask: askFrom(['n']), catalog: en, stdinIsTTY: true }),
  );
  assert.deepEqual(value, { accepted: false, reason: 'declined' });
});

test('confirmDisclaimerAcceptance: invalid then yes -> accepted (re-prompts)', async () => {
  const { value } = await captureStdout(() =>
    confirmDisclaimerAcceptance({ ask: askFrom(['what', 'y']), catalog: en, stdinIsTTY: true }),
  );
  assert.deepEqual(value, { accepted: true, reason: 'interactive' });
});

test('confirmDisclaimerAcceptance: no recognizable answer within attempts -> no-answer, not accepted', async () => {
  const { value } = await captureStdout(() =>
    confirmDisclaimerAcceptance({ ask: askFrom(['x', 'x', 'x', 'x', 'x']), catalog: en, stdinIsTTY: true }),
  );
  assert.deepEqual(value, { accepted: false, reason: 'no-answer' });
});

test('confirmDisclaimerAcceptance: non-TTY without --accept-disclaimer -> non-interactive abort, ask never called', async () => {
  let called = false;
  const ask = async () => { called = true; return 'y'; };
  const { value } = await captureStdout(() =>
    confirmDisclaimerAcceptance({ ask, catalog: en, preAccepted: false, stdinIsTTY: false }),
  );
  assert.deepEqual(value, { accepted: false, reason: 'non-interactive' });
  assert.equal(called, false);
});
